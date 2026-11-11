import { describe, expect, it } from "vitest";
import { declareIntercept, interceptProblem, interceptionCourse, resolveInterceptions, type InterceptDeclaration } from "../src/engine/naval-intercept";
import { navalOf } from "../src/engine/naval-record";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { rollD6 } from "../src/engine/rng";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

export const course = ["K21", "L20", "L19", "M18", "N18"];
export function interceptPosition(): GameState {
  const s = setManualFleetMove(board([
    counter("b1", "britain", "fleet", 9, "N18"), counter("b2", "britain", "fleet", 9, "K21"),
    counter("g1", "germany", "fleet", 9, "K28"), counter("g2", "germany", "fleet", 9, "K28"),
    counter("g3", "germany", "fleet", 9, "K29"),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6c" } }), true);
  return { ...s, naval: { ...navalOf(s), moved: ["b1"], moves: [{ fleet: "b1", from: "K21", to: "N18", front: "western", path: [...course] }] } };
}
export const declaration: InterceptDeclaration = { side: "axis", target: "move:0", fleets: ["g1"], meetingPoint: "N18" };
const named = (s: GameState, d = declaration) => { expect(interceptProblem(CTX, s, d)).toBeNull(); return declareIntercept(CTX, s, d); };
const resolve = (s: GameState) => resolveInterceptions(CTX, s);

describe("pure naval interception (spec 12 R11/R12, Ref 21.5/21.51; AER84–91)", () => {
  it("accepts departure, intermediate and arrival points, using a legal sea course (R11/N23/AER87)", () => {
    const s = interceptPosition();
    for (const meetingPoint of course) expect(interceptProblem(CTX, s, { ...declaration, meetingPoint })).toBeNull();
    const path = interceptionCourse(CTX, s, "axis", "western", "K28", "N18")!;
    expect(path[0]).toBe("K28"); expect(path.at(-1)).toBe("N18"); expect(path.length).toBeGreaterThan(2);
    expect(interceptionCourse(CTX, s, "axis", "western", "K28", "D44")).toBeNull();
    expect(interceptProblem(CTX, s, { ...declaration, meetingPoint: "A1" })).toMatch(/course/);
    // Spec 12 R11: a reachable point outside the target's course is still illegal.
    expect(interceptionCourse(CTX, s, "axis", "western", "K28", "K28")).not.toBeNull();
    expect(interceptProblem(CTX, s, { ...declaration, meetingPoint: "K28" })).toMatch(/meeting point must lie on the target course/);
  });
  it.each([undefined, false])("requires opt-in (%s), and a current recorded movement (AER75/AER85)", flag => {
    const s = interceptPosition();
    expect(interceptProblem(CTX, { ...s, naval: { ...s.naval!, manualFleetMove: flag } }, declaration)).toMatch(/recorded/);
    expect(interceptProblem(CTX, { ...s, naval: { ...s.naval!, moves: [] } }, declaration)).toMatch(/recorded/);
    expect(interceptProblem(CTX, { ...s, year: s.year + 1 }, declaration)).toMatch(/recorded/);
  });
  it.each(["supply", "intercept", "mission", "escort", "new"] as const)("refuses used fleets (%s), moved, tried and gray fleets (R5/R11)", used => {
    const s = interceptPosition();
    expect(interceptProblem(CTX, { ...s, naval: { ...s.naval!, used: { g1: used } } }, declaration)).toMatch(/free/);
    for (const changes of [{ moved: ["g1"] }, { triedIntercept: ["g1"] }, { supply: [{ from: "K28", to: "N18", fleets: ["g1"], units: [] }] }]) {
      expect(interceptProblem(CTX, { ...s, naval: { ...s.naval!, ...changes } }, declaration)).toMatch(/free/);
    }
    expect(interceptProblem(CTX, { ...s, grayFleets: { g1: { year: s.year + 1, season: s.season } } }, declaration)).toMatch(/free/);
  });
  it("refuses supply/escort targets, own targets, neutral fleets and the wrong Front (R11/AER85)", () => {
    const s = interceptPosition();
    for (const used of ["supply", "escort"] as const) expect(interceptProblem(CTX, { ...s, naval: { ...s.naval!, used: { b1: used } } }, declaration)).toMatch(/cannot be intercepted/);
    expect(interceptProblem(CTX, s, { ...declaration, side: "allies" })).toMatch(/round/);
    expect(interceptProblem(CTX, { ...s, units: { ...s.units, g1: { ...s.units.g1!, owner: "italy" } } }, declaration)).toMatch(/hostile/);
    expect(interceptProblem(CTX, { ...s, units: { ...s.units, g1: { ...s.units.g1!, at: "J32" } } }, declaration)).toMatch(/Front/);
  });
  it("refuses malformed/duplicate fleet lists and invalid break-off (C2)", () => {
    const s = interceptPosition();
    for (const fleets of [null, [], ["g1", "g1"], ["missing"], ["__proto__"], [null], Array(1)]) {
      expect(interceptProblem(CTX, s, { ...declaration, fleets } as InterceptDeclaration)).not.toBeNull();
    }
    expect(interceptProblem(CTX, s, { ...declaration, breakOff: 1 } as unknown as InterceptDeclaration)).toMatch(/boolean/);
  });
  it("merges bases at one point, reserves fleets, and enforces one target per base (R11/R13/AER86)", () => {
    const s = named(interceptPosition());
    expect(interceptProblem(CTX, s, declaration)).toMatch(/free/);
    expect(interceptProblem(CTX, s, { ...declaration, fleets: ["g2"], meetingPoint: "K21" })).toMatch(/One target/);
    const combined = named(s, { ...declaration, fleets: ["g2", "g3"] });
    expect(combined.naval!.interceptions).toHaveLength(1);
    expect(combined.naval!.interceptions![0]!.fleets).toEqual(["g1", "g2", "g3"]);
    // AER119: use a different destination so this remains a distinct target for the one-base restriction.
    const extra = { ...s, naval: { ...s.naval!, moves: [...s.naval!.moves!, { ...s.naval!.moves![0]!, fleet: "b2", to: "K21" }] } };
    expect(interceptProblem(CTX, extra, { ...declaration, fleets: ["g2"], target: "move:1" })).toMatch(/one base/);
  });
  it("counter-targets an earlier course and seals that force against later additions (R11/AER86)", () => {
    const first = named(interceptPosition());
    const s = { ...first, naval: { ...first.naval!, interceptSide: "allies" as const } };
    const second = named(s, { side: "allies", target: "intercept:0", fleets: ["b2"], meetingPoint: "N18" });
    expect(second.naval!.interceptions).toHaveLength(2);
    expect(interceptProblem(CTX, { ...second, naval: { ...second.naval!, interceptSide: "axis" } }, { ...declaration, fleets: ["g2"] })).toMatch(/sealed/);
  });
  it("rolls once per base in hex-id order and only successful bases fight (R11/R21)", () => {
    const s = named(interceptPosition(), { ...declaration, fleets: ["g3", "g2", "g1"] });
    const before = structuredClone(s), done = resolve(s);
    const attempts = done.events.filter(e => e.type === "INTERCEPTION_ATTEMPTED");
    expect(attempts.map(e => e.base)).toEqual(["K28", "K29"]);
    expect(attempts[0]!.fleets).toEqual(["g2", "g1"]);
    expect(attempts.map(e => e.die)).toEqual([rollD6(s.rngState).roll, rollD6(rollD6(s.rngState).state).roll]);
    expect(done).toEqual(resolve(structuredClone(s)));
    expect(s).toEqual(before);
  });
  it("automatic same-base attempts consume only the two combat dice (R11/AER87)", () => {
    const s = interceptPosition(); s.units.g1 = { ...s.units.g1!, at: "N18" };
    const done = resolve(named(s));
    const attempt = done.events.find(e => e.type === "INTERCEPTION_ATTEMPTED")!;
    expect(attempt).toMatchObject({ distance: 0, needed: "automatic", die: null, success: true });
    expect(done.state.rngState).toBe(rollD6(rollD6(s.rngState).state).state);
  });
  it("failed attempts bar fleets only for the Player Turn, without a Game Turn function (R5/R11)", () => {
    const s = named(interceptPosition());
    // Seed 5 rolls 5: K28 to N18 is 11–18 sea hexsides, requiring 1–4 (verified table).
    const done = resolve({ ...s, rngState: 5 });
    expect(done.events.find(e => e.type === "INTERCEPTION_ATTEMPTED")).toMatchObject({ success: false });
    expect(done.state.naval!.triedIntercept).toContain("g1");
    expect(done.state.naval!.used.g1).toBeUndefined();
    expect(navalOf({ ...done.state, activeSide: "axis" }).triedIntercept).toEqual([]);
  });
  it("a winning counter cancels its earlier target with no additional dice (R11/R12/AER88)", () => {
    const start = interceptPosition();
    start.units.g1 = { ...start.units.g1!, at: "N18", strength: 1 };
    start.units.b2 = { ...start.units.b2!, at: "N18", strength: 36 };
    const first = named(start);
    const second = named({ ...first, naval: { ...first.naval!, interceptSide: "allies" } }, { side: "allies", target: "intercept:0", fleets: ["b2"], meetingPoint: "N18" });
    const done = resolve(second);
    expect(done.events.filter(e => e.type === "INTERCEPTION_ATTEMPTED")).toHaveLength(1);
    expect(done.events).toContainEqual({ type: "INTERCEPTION_CANCELLED", side: "axis", interception: "intercept:0" });
    expect(done.state.units.b1!.at).toBe("N18");
    expect(done.state.rngState).toBe(rollD6(rollD6(start.rngState).state).state);
  });
  it("uses battle row for Italian DRM, breaks off before rolling, and keeps nonparticipants untouched (R12/R13)", () => {
    const s = interceptPosition();
    s.units.g1 = { ...s.units.g1!, nationality: "italy", at: "N18" };
    const before = structuredClone(s);
    const done = resolve(named(s, { ...declaration, breakOff: true }));
    const fight = done.events.find(e => e.type === "NAVAL_COMBAT_RESOLVED")!;
    expect(fight.result).toMatchObject({ breakOff: true, winner: "intercepted", interceptor: { nationalityDrm: -1 } });
    expect(done.state.units.g2).toEqual(s.units.g2);
    expect(done.state.naval!.used.g1).toBe("intercept");
    expect(s).toEqual(before);
  });
});
