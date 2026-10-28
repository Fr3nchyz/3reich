import { afterEach, describe, expect, it } from "vitest";
import { newAirTurn, markFlown } from "../src/engine/air-record";
import { turnKey } from "../src/engine/combat-record";
import type { GameContext } from "../src/engine/context";
import { distance, hex } from "../src/engine/hex";
import {
  baseChangeFrontProblem, baseChangeHeldProblem, baseChangeOnceProblem, baseChangeOptionProblem,
  baseChangeOrderProblem, baseChangePortProblem, baseChangeProblem,
} from "../src/engine/naval-change";
import { mayBasePort } from "../src/engine/naval-ports";
import { markGray, markUsed, navalOf } from "../src/engine/naval-record";
import { baseChangeCourseProblem, baseChangeRoute, baseChangeStepProblem, PORT_OPENING_HEXSIDES } from "../src/engine/naval-routes";
import { ONE_BASE_CHANGE_PER_TURN } from "../src/engine/naval-rules";
import type { FrontOption, GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 12 R10 (Ref 21.2): each Checks-table row is tested alone and through the combined query.
const fleet = (id = "b1", owner: Unit["owner"] = "britain", at = "K21", strength = 9): Unit => counter(id, owner, "fleet", strength, at);
const mover = fleet();
const normalCourse = ["K21", "L20", "L19", "M18", "N18"];
function position(units: Unit[] = [mover], extra: Partial<GameState> = {}): GameState {
  const s = board(units, undefined, {
    activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    frontOptions: { western: { option: "attrition" } }, control: { N18: "britain" }, ...extra,
  });
  return { ...s, air: newAirTurn(s) };
}
const problem = (s: GameState, path?: readonly string[]) => baseChangeProblem(CTX, s, mover, "N18", "western", path);
const option = (s: GameState, choice: FrontOption): GameState => ({ ...s, frontOptions: { western: { option: choice } } });
const step = (s: GameState, from: string, to: string, front: "western" | "mediterranean" = "western", ctx = CTX) =>
  baseChangeStepProblem(ctx, s, "allies", front, from, to);

// No guessed real opening sides (Ref 4.7, N38): these entries exist only inside the mechanism test.
afterEach(() => {
  delete PORT_OPENING_HEXSIDES.K21;
  delete PORT_OPENING_HEXSIDES.AA25;
});

describe("R10 Checks: Option (Ref 11.41, 11.42, N20)", () => {
  it("allows a plain change, explicit course or shortest course, without changing any input", () => {
    const s = position();
    const before = structuredClone(s);
    expect(problem(s)).toBeNull();
    expect(problem(s, normalCourse)).toBeNull();
    expect(s).toEqual(before);
    expect(baseChangeOptionProblem(CTX, s, mover, "western", normalCourse)).toBeNull();
  });

  it.each(["offensive", "attrition"] as const)("%s ignores enemy fleets and nearby planes", (choice) => {
    const s = option(position([mover, fleet("g1", "germany", "K28"), counter("p1", "germany", "air", 5, "K25")]), choice);
    expect(problem(s)).toBeNull();
  });

  it("Pass allows no threats and enemy fleets based only on another Front", () => {
    expect(problem(option(position(), "defensive"))).toBeNull();
    expect(problem(option(position([mover, fleet("g1", "germany", "U22")]), "defensive"))).toBeNull();
    expect(problem(option(position([mover, fleet("i1", "italy", "K28")]), "defensive"))).toBeNull(); // neutral Italy
  });

  it.each(["K28", "J30"])("Pass refuses an enemy fleet based at %s on this Front, including a two-Front port", (at) => {
    const s = option(position([mover, fleet("g1", "germany", at)]), "defensive");
    expect(problem(s)).toMatch(/Pass Option: enemy fleet/);
  });

  it.each([["K25", 4, true], ["K26", 5, false]] as const)("Pass with a plane at %s: distance %i", (at, d, refused) => {
    const s = option(position([mover, counter("p1", "germany", "air", 5, at)]), "defensive");
    expect(Math.min(...normalCourse.map((h) => distance(hex(h), hex(at))))).toBe(d);
    expect(problem(s) !== null).toBe(refused);
  });

  it("counts the arrival port and intermediate hexes, even for planes that have already flown", () => {
    const s = markFlown(option(position([mover, counter("p1", "germany", "air", 5, "U26")]), "defensive"), ["p1"], "ground-support");
    expect(baseChangeOptionProblem(CTX, s, mover, "western", ["K21", "N18"])).toBeNull();
    expect(baseChangeOptionProblem(CTX, s, mover, "western", ["K21", "U22", "N18"])).toMatch(/enemy plane/);
    const end = option(position([mover, counter("p1", "germany", "air", 5, "N14")]), "defensive");
    expect(distance(hex("K21"), hex("N14"))).toBeGreaterThan(4);
    expect(problem(end)).toMatch(/enemy plane/);
  });
});

describe("R10 Checks: Same Front, Held at the start (R3; Ref 21.1, 21.2)", () => {
  it("requires both ports on the named fleet Front; Marseilles uses its water Front", () => {
    expect(baseChangeFrontProblem(CTX, mover, "N18", "western")).toBeNull();
    expect(baseChangeProblem(CTX, position(), mover, "N18", "mediterranean")).toMatch(/Both ports/);
    expect(baseChangeFrontProblem(CTX, fleet("i1", "italy", "U22"), "V19", "mediterranean")).toBeNull();
    expect(baseChangeFrontProblem(CTX, fleet("g1", "germany", "J30"), "J35", "eastern")).toBeNull();
    expect(baseChangeFrontProblem(CTX, mover, "U22", "western")).toMatch(/Both ports/);
  });

  it("reads controlAtStart: a newly taken port fails alone; a port held then passes", () => {
    const s = position();
    expect(baseChangeHeldProblem(CTX, s, "allies", "N18")).toBeNull();
    const taken = { ...s, air: { ...s.air!, controlAtStart: { N18: "germany" as const } } };
    expect(problem(taken)).toMatch(/at the start/);
    expect(baseChangeHeldProblem(CTX, taken, "allies", "N18")).toMatch(/at the start/);
    const lost = { ...s, control: { N18: "germany" as const } };
    expect(baseChangeHeldProblem(CTX, lost, "allies", "N18")).toBeNull();
    expect(problem(lost)).toMatch(/not held/); // current ownership is a separate basing check
    expect(baseChangeHeldProblem(CTX, s, "allies", "K21")).toBeNull(); // scenario control fallback
  });
});

describe("R10 Checks: Room and nation (R2, R4; Ref 21.1, 26.0, 27.0)", () => {
  it("fits exactly 36 factors; a further counter fails alone, and ground/air use no naval room", () => {
    const others = [fleet("b2", "britain", "N18"), fleet("b3", "britain", "N18"), fleet("b4", "britain", "N18")];
    const s = position([mover, ...others, counter("a1", "britain", "air", 5, "N18")]);
    expect(baseChangePortProblem(CTX, s, mover, "N18")).toBeNull();
    expect(problem(s)).toBeNull();
    expect(problem(position([mover, ...others, fleet("b5", "britain", "N18", 1)]))).toMatch(/37 naval factors.*limit 36/);
  });

  it.each(["GG19", "GG26", "GG34"])("the small port %s fits 9, refuses 10 (R2)", (to) => {
    const s = position([mover], { control: { [to]: "britain" } });
    expect(baseChangePortProblem(CTX, s, mover, to)).toBeNull();
    expect(baseChangePortProblem(CTX, { ...s, units: { ...s.units, b2: fleet("b2", "britain", to, 1) } }, mover, to)).toMatch(/10 naval factors.*limit 9/);
  });

  it("an empty French port is allowed before 1942; any French unit, including an airbase, refuses sharing (R4)", () => {
    expect(mayBasePort(CTX, position(), mover, "N18")).toBeNull();
    const empty = position([mover], { control: { N18: "france" } });
    expect(problem(empty)).toBeNull();
    for (const type of ["fleet", "air", "airbase", "infantry"] as const) {
      const s = position([mover, counter("f1", "france", type, 1, "N18")]);
      expect(problem(s)).toMatch(/British and French/);
      expect(problem({ ...s, year: 1942 })).toBeNull();
    }
    const british = position([fleet("f1", "france"), mover], { control: { N18: "britain" } });
    expect(mayBasePort(CTX, british, fleet("f1", "france"), "N18")).toBeNull();
    expect(mayBasePort(CTX, { ...british, units: { b2: fleet("b2", "britain", "N18") } }, fleet("f1", "france"), "N18")).toMatch(/British and French/);
  });

  it("nationality overrides ownership for sharing and the Russian/Western ban (R4)", () => {
    const printedFrench = { ...fleet("f1", "britain", "N18"), nationality: "france" as const };
    expect(problem(position([mover, printedFrench]))).toMatch(/British and French/);
    const s = position();
    const alliedRussia = { ...s, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" as const } } };
    expect(mayBasePort(CTX, alliedRussia, { ...mover, nationality: "ussr" }, "N18")).toMatch(/Russian and Western/);
    const russianPort = { ...alliedRussia, control: { N18: "ussr" as const } };
    expect(problem(russianPort)).toMatch(/Russian and Western/);
    expect(mayBasePort(CTX, russianPort, fleet("r1", "ussr"), "N18")).toBeNull();
  });

  it("requires a friendly port and rejects neutral ownership and non-ports (R2, R4)", () => {
    expect(mayBasePort(CTX, position(), mover, "K22")).toMatch(/not a port/);
    expect(mayBasePort(CTX, position(), mover, "K28")).toMatch(/not held/);
    expect(mayBasePort(CTX, position(), mover, "U22")).toMatch(/not held/);
  });
});

describe("R10 Checks: Once and Before the rest (Ref 21.2; Ops 5.45b; N19)", () => {
  it("one change per Player Turn; another fleet and a stale record do not count", () => {
    const s = position();
    expect(ONE_BASE_CHANGE_PER_TURN).toBe(true);
    expect(baseChangeOnceProblem(s, mover.id)).toBeNull();
    const moved = { ...s, naval: { ...navalOf(s), moved: [mover.id] } };
    expect(problem(moved)).toMatch(/already changed base/);
    expect(baseChangeOnceProblem(moved, "b2")).toBeNull();
    expect(problem({ ...moved, naval: { ...moved.naval, turn: "old-turn" } })).toBeNull();
  });

  it("6b before anyone moves passes; ground/air movement and air staging each fail alone", () => {
    const s = position();
    expect(baseChangeOrderProblem(s)).toBeNull();
    for (const type of ["infantry", "air"] as const) {
      const moved = position([mover, counter("u1", "britain", type, 3, "K22")]);
      expect(problem({ ...moved, moves: { turn: turnKey(moved), moved: ["u1"] } })).toMatch(/before any air or ground/);
    }
    expect(problem({ ...s, air: { ...s.air!, staged: ["p1"] } })).toMatch(/before any air or ground/);
    expect(problem({ ...s, position: { part: "player-turn", turn: 1, step: "6f" } })).toMatch(/step 6b/);
    expect(problem({ ...s, moves: { turn: "old-turn", moved: ["u1"] } })).toBeNull();
    expect(problem({ ...s, air: { ...s.air!, turn: "old-turn", staged: ["p1"] } })).toBeNull();
  });

  it("new and gray fleets cannot change base; a base change uses no function (R5; Ref 21.3, 11.62)", () => {
    const s = position();
    expect(problem(markGray(s, mover.id))).toMatch(/gray fleet/);
    expect(problem(markUsed(s, [mover.id], "new"))).toMatch(/built this Game Turn/);
    expect(problem(markUsed(s, [mover.id], "intercept"))).toBeNull();
    expect(baseChangeProblem(CTX, s, counter("p1", "britain", "air", 5, "K21"), "N18", "western")).toMatch(/not a fleet/);
    expect(baseChangeProblem(CTX, s, fleet("g1", "germany"), "N18", "western")).toMatch(/active side/);
    expect(baseChangeProblem(CTX, s, mover, "K21", "western")).toMatch(/already this fleet/);
  });
});

describe("R10 Course (Ref 4.3, 4.7, 11.41, 21.2, 34.0)", () => {
  it("allows partly ocean hexsides despite neutral coast, enemy units and armor zones", () => {
    const s = position([mover, counter("g1", "germany", "armor", 4, "I30", 6)]);
    expect(step(s, "K21", "L20")).toBeNull();
    expect(step(s, "AA24", "AA25", "mediterranean")).toBeNull();
    expect(step(s, "Z7", "AA7")).toBeNull(); // neutral Spanish coast to Gibraltar
    expect(step(s, "I29", "I30")).toBeNull(); // hostile armor on the course
  });

  it("a crossing-arrow strait requires both land sides friendly; hostile or neutral alone blocks either direction", () => {
    const s = position([], { control: { I30: "britain", I31: "britain" } });
    expect(step(s, "I30", "I31")).toBeNull();
    expect(step(s, "I31", "I30")).toBeNull();
    for (const bank of ["I30", "I31"]) for (const holder of ["germany", null] as const) {
      const blocked = { ...s, control: { ...s.control, [bank]: holder } };
      expect(step(blocked, "I30", "I31")).toMatch(/crossing-arrow/);
      expect(step(blocked, "I31", "I30")).toMatch(/crossing-arrow/);
      expect(baseChangeRoute(CTX, blocked, "allies", "western", "I30", "I31")).not.toEqual(["I30", "I31"]);
    }
  });

  it("Gibraltar can be an endpoint on either Front, but a course cannot pass through to the other Front", () => {
    const s = position();
    expect(step(s, "AA6", "AA7")).toBeNull();
    expect(step(s, "AA7", "AA8", "mediterranean")).toBeNull();
    expect(step(s, "AA7", "AA8")).toMatch(/Front boundary/);
    expect(step(s, "AA6", "AA7", "mediterranean")).toMatch(/Front boundary/);
    expect(baseChangeCourseProblem(CTX, s, "allies", "western", "AA6", "AA8", ["AA6", "AA7", "AA8"])).toMatch(/Front boundary/);
    expect(baseChangeRoute(CTX, s, "allies", "western", "AA6", "AA8")).toBeNull();
    expect(baseChangeRoute(CTX, s, "allies", "mediterranean", "AA7", "GG19")).not.toBeNull();
  });

  it("rivers block even a sea-marked side; the Suez Canal is the exception with all four banks friendly (N22)", () => {
    expect(step(position(), "J29", "K29")).toMatch(/river/);
    const control = Object.fromEntries(["LL30", "LL31", "MM30", "MM31"].map((h) => [h, "britain" as const]));
    const s = position([], { control });
    for (const [from, to] of [["LL30", "LL31"], ["LL31", "MM30"], ["MM30", "MM31"]] as const) {
      expect(step(s, from, to, "mediterranean")).toBeNull();
      expect(step(s, to, from, "mediterranean")).toBeNull();
    }
    expect(baseChangeRoute(CTX, s, "allies", "mediterranean", "LL31", "MM30")).toEqual(["LL31", "MM30"]);
    for (const bank of Object.keys(control)) for (const holder of ["germany", null] as const) {
      const blocked = { ...s, control: { ...s.control, [bank]: holder } };
      expect(step(blocked, "LL31", "MM30", "mediterranean")).toMatch(/all four/);
      expect(baseChangeRoute(CTX, blocked, "allies", "mediterranean", "LL31", "MM30")).toBeNull();
    }
  });

  it.each([["K21", "L20", "K20", "western"], ["AA25", "AA26", "Z25", "mediterranean"]] as const)("%s opening mechanism rejects wrong entry and exit sides (Ref 4.7, N38; test-only values)", (port, allowed, wrong, front) => {
    expect(PORT_OPENING_HEXSIDES).toEqual({});
    const s = position();
    // Plymouth already has only one sea side in the data. Add a second in this test to exercise the table, not the map.
    const ctx: GameContext = { ...CTX, map: { ...CTX.map, hexsides: {
      ...CTX.map.hexsides, "K20-K21": { id: "K20-K21", land: false, sea: true },
    } } };
    expect(step(s, port, allowed, front, ctx)).toBeNull();
    expect(step(s, port, wrong, front, ctx)).toBeNull();
    PORT_OPENING_HEXSIDES[port] = [allowed];
    expect(step(s, port, allowed, front, ctx)).toBeNull();
    expect(step(s, allowed, port, front, ctx)).toBeNull();
    expect(step(s, port, wrong, front, ctx)).toMatch(/does not open/);
    expect(step(s, wrong, port, front, ctx)).toMatch(/does not open/);
    const route = baseChangeRoute(ctx, s, "allies", front, port, wrong);
    expect(route?.[1]).toBe(allowed);
    PORT_OPENING_HEXSIDES[port] = [];
    expect(step(s, port, wrong, front, ctx)).toBeNull();
  });

  it("rejects a broken course, absent sea hexside, land and off-map ends", () => {
    const s = position();
    expect(problem(s, [])).toMatch(/old port to the new port/);
    expect(problem(s, [...normalCourse].reverse())).toMatch(/old port to the new port/);
    expect(problem(s, ["K21", "N18"])).toMatch(/adjacent water/);
    expect(step(s, "K21", "K22")).toMatch(/water step/);
    expect(step(s, "K21", "ZZ99")).toMatch(/water step/);
    const ctx: GameContext = { ...CTX, map: { ...CTX.map, hexsides: {} } };
    expect(step(s, "K21", "L20", "western", ctx)).toMatch(/no ocean/);
    expect(baseChangeRoute(ctx, s, "allies", "western", "K21", "N18")).toBeNull();
    expect(baseChangeProblem(ctx, s, mover, "N18", "western")).toMatch(/No sea course/);
    expect(baseChangeRoute(CTX, s, "allies", "western", "K22", "N18")).toBeNull();
    expect(baseChangeRoute(CTX, s, "allies", "western", "K21", "ZZ99")).toBeNull();
  });

  it("breadth-first shortest-route tie-break is fixed E, W, NE, NW, SE, SW (R10)", () => {
    const s = position();
    // A rhombus with exactly two equally short sea courses; W precedes SW in the neighbour order.
    const ids = ["K21", "K20", "L20", "L19"];
    const edges = ["K20-K21", "K20-L19", "K21-L20", "L19-L20"];
    const ctx: GameContext = { ...CTX, map: {
      hexes: Object.fromEntries(ids.map((id) => [id, CTX.map.hexes[id]!])),
      hexsides: Object.fromEntries(edges.map((id) => [id, { id, land: false, sea: true }])),
    } };
    expect(baseChangeRoute(ctx, s, "allies", "western", "K21", "L19")).toEqual(["K21", "K20", "L19"]);
    expect(baseChangeRoute(CTX, s, "allies", "western", "K21", "N18")).toEqual(normalCourse);
    expect(baseChangeRoute(CTX, s, "allies", "western", "K21", "K21")).toEqual(["K21"]);
    expect(baseChangeRoute(CTX, s, "allies", "western", "K21", "C33")!.length).toBeGreaterThan(8); // unlimited range
  });
});
