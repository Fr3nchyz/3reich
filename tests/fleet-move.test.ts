import { describe, expect, it } from "vitest";
import { turnKey } from "../src/engine/combat-record";
import { newAirTurn } from "../src/engine/air-record";
import type { GameContext } from "../src/engine/context";
import { fleetMoveOptions, fleetMoveProblem, movableFleets, moveFleet, type FleetMove } from "../src/engine/fleet-move";
import { markGray, markUsed, navalOf } from "../src/engine/naval-record";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const fleet = (id = "b1", owner: Unit["owner"] = "britain", at = "K21", strength = 9): Unit => counter(id, owner, "fleet", strength, at);
const course = ["K21", "L20", "L19", "M18", "N18"];
const move: FleetMove = { fleet: "b1", to: "N18", front: "western" };
function position(units: Unit[] = [fleet()], extra: Partial<GameState> = {}): GameState {
  const s = board(units, undefined, {
    activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    frontOptions: { western: { option: "attrition" }, eastern: { option: "attrition" }, mediterranean: { option: "attrition" } },
    control: { N18: "britain", C33: "britain" }, ...extra,
  });
  return { ...s, air: newAirTurn(s) };
}
const problem = (s: GameState, change: Partial<FleetMove> = {}, ctx = CTX) => fleetMoveProblem(ctx, s, { ...move, ...change });
function moved(s: GameState = position(), change: Partial<FleetMove> = {}) {
  const result = moveFleet(CTX, s, { ...move, ...change });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("fleet movement at 6b (spec 12 R10, Ref 21.2)", () => {
  it("moves only the named fleet, records once, preserves every other record and is immutable (Ref 21.2, 21.3)", () => {
    let s = position([fleet(), fleet("b2")]);
    s = { ...s, naval: { ...navalOf(s), moved: ["other"], triedIntercept: ["failed"], supply: [{ fleets: ["other"], from: "K21", to: "C33", units: [] }] } };
    s = markUsed(s, ["b2"], "intercept");
    const before = structuredClone(s);
    const result = moved(s);
    expect(result.course).toEqual(course);
    expect(result.state).toEqual({ ...s, units: { ...s.units, b1: { ...s.units.b1!, at: "N18" } }, naval: { ...s.naval!, moved: ["other", "b1"] } });
    expect(result.state.units.b2).toBe(s.units.b2);
    expect(result.state.naval!.used).toEqual({ b2: "intercept" });
    expect(s).toEqual(before);
    expect(moveFleet(CTX, s, move)).toEqual(result);
  });

  it("accepts an explicit course and returns its own copy (Ref 21.2)", () => {
    const path = [...course];
    const result = moved(position(), { path });
    expect(result.course).toEqual(path);
    result.course.pop();
    expect(path).toEqual(course);
  });

  it.each(["missing", "constructor", "__proto__"])("refuses unknown fleet %s without throwing", (id) => {
    const s = position();
    expect(problem(s, { fleet: id })).toMatch(/not on the map/);
    expect(fleetMoveOptions(CTX, s, id)).toEqual([]);
    expect(moveFleet(CTX, s, { ...move, fleet: id })).toEqual({ ok: false, error: `${id} is not on the map.` });
  });

  it("rejects nonfleets, enemy and neutral fleets, the same base and nonport origins (Ref 21.2)", () => {
    expect(problem(position([counter("b1", "britain", "air", 5, "K21")]))).toMatch(/not a fleet/);
    expect(problem(position([fleet("b1", "germany")]))).toMatch(/active side/);
    expect(problem(position([fleet("b1", "italy")]))).toMatch(/active side/);
    expect(problem(position(), { to: "K21" })).toMatch(/already/);
    expect(fleetMoveOptions(CTX, position([fleet("b1", "britain", "K22")]), "b1")).toEqual([]);
  });

  it("requires step 6b before ground movement or air staging (Ref 21.2; Ops 5.45b)", () => {
    const s = position();
    expect(problem({ ...s, phase: "setup" })).toMatch(/step 6b/);
    expect(problem({ ...s, position: null })).toMatch(/step 6b/);
    expect(problem({ ...s, position: { part: "player-turn", turn: 1, step: "6f" } })).toMatch(/step 6b/);
    expect(problem({ ...s, air: { ...s.air!, staged: ["air"] } })).toMatch(/before any/);
    expect(problem({ ...s, moves: { turn: turnKey(s), moved: ["ground"] } })).toMatch(/before any/);
    expect(movableFleets(CTX, { ...s, position: null })).toEqual([]);
  });

  it("refuses new and gray fleets, but base change consumes no function (Ref 21.3, 11.62; spec 12 R5)", () => {
    expect(problem(markUsed(position(), ["b1"], "new"))).toMatch(/built this Game Turn/);
    expect(problem(markGray(position(), "b1"))).toMatch(/gray fleet/);
    for (const kind of ["supply", "intercept", "mission", "escort"] as const) {
      const s = markUsed(position(), ["b1"], kind);
      expect(moved(s).state.naval!.used).toEqual({ b1: kind });
    }
  });

  it("must change base before carrying supply this Player Turn (Ref 21.3; spec 12 R5/R6)", () => {
    const s = markUsed(position(), ["b1"], "supply");
    const naval = { ...navalOf(s), supply: [{ fleets: ["b1"], from: "K21", to: "C33", units: [] }] };
    expect(problem({ ...s, naval })).toMatch(/already carries sea supply/);
    expect(movableFleets(CTX, { ...s, naval })).toEqual([]);
    expect(problem({ ...s, naval: { ...naval, turn: "previous-player-turn" } })).toBeNull();
  });

  it("bars a second change, but expires the moved list at a new Player Turn (Ref 21.2; N19)", () => {
    const s = moved().state;
    expect(problem(s, { to: "C33" })).toMatch(/already changed base/);
    expect(fleetMoveOptions(CTX, s, "b1")).toEqual([]);
    const stale = { ...position(), naval: { ...s.naval!, turn: "old-turn" } };
    expect(moved(stale).state.naval!.moved).toEqual(["b1"]);
  });

  it("checks initial and current destination ownership separately (Ref 21.2, 21.1)", () => {
    const s = position();
    expect(problem({ ...s, air: { ...s.air!, controlAtStart: { ...s.air!.controlAtStart, N18: "germany" } } })).toMatch(/at the start/);
    expect(problem({ ...s, control: { ...s.control, N18: "germany" } })).toMatch(/not held/);
    expect(problem(s, { to: "constructor" })).toMatch(/Both ports/);
  });

  it("accepts exact port capacity and rejects one factor too many (Ref 21.1; spec 12 R2)", () => {
    expect(problem(position([fleet(), fleet("b2", "britain", "N18", 27)]))).toBeNull();
    expect(problem(position([fleet(), fleet("b2", "britain", "N18", 28)]))).toMatch(/limit 36/);
    const s = position([fleet("b1", "britain", "LL29"), fleet("b2", "britain", "GG19", 1)], { control: { GG19: "britain" } });
    expect(problem(s, { to: "GG19", front: "mediterranean" })).toMatch(/limit 9/);
    expect(problem(position([fleet("b1", "britain", "LL29")], { control: { GG19: "britain" } }), { to: "GG19", front: "mediterranean" })).toBeNull();
  });

  it("applies national basing restrictions, including airbases (Ref 26.0, 27.0; spec 12 R4)", () => {
    expect(problem(position([fleet(), counter("f", "france", "airbase", 0, "N18")]))).toMatch(/British and French/);
    expect(problem(position([fleet("b1", "ussr", "D44")], { control: { E38: "britain" } }), { to: "E38", front: "eastern" })).not.toBeNull();
    const s = position();
    const nations = { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" as const } };
    expect(problem(position([fleet()], { nations, control: { N18: "ussr" } }))).toMatch(/Russian and Western/);
  });

  it("delegates Pass threats and broken explicit courses (Ref 11.42, 21.2; N20)", () => {
    const extra: Partial<GameState> = { frontOptions: { western: { option: "defensive" } } };
    expect(problem(position([], extra))).toMatch(/not on the map/);
    expect(problem(position([fleet()], extra))).toBeNull();
    expect(problem(position([fleet(), fleet("g", "germany", "K28")], extra))).toMatch(/enemy fleet/);
    expect(problem(position([fleet(), counter("p", "germany", "air", 5, "K25")], extra))).toMatch(/enemy plane/);
    expect(problem(position(), { path: [] })).toMatch(/old port to the new port/);
    expect(problem(position(), { path: ["K21", "N18"] })).toMatch(/adjacent water/);
    const ctx: GameContext = { ...CTX, map: { ...CTX.map, hexsides: {} } };
    expect(problem(position(), {}, ctx)).toMatch(/No sea course/);
    expect(fleetMoveOptions(ctx, position(), "b1")).toEqual([]);
  });

  it("lists every legal port deterministically with unlimited range (Ref 21.2)", () => {
    const s = position([fleet("z"), fleet("b1"), counter("air", "britain", "air", 5, "K21")]);
    const before = structuredClone(s);
    const options = fleetMoveOptions(CTX, s, "b1");
    expect(options).toContainEqual({ ...move, path: course });
    expect(options.find((o) => o.to === "C33")!.path!.length).toBeGreaterThan(8);
    expect(options.some((o) => o.to === "K21")).toBe(false);
    expect(options.map((o) => o.to)).toEqual(options.map((o) => o.to).sort());
    for (const o of options) expect(moveFleet(CTX, s, o).ok).toBe(true);
    expect(movableFleets(CTX, s)).toEqual(["b1", "z"]);
    expect(fleetMoveOptions(CTX, s, "b1")).toEqual(options);
    expect(s).toEqual(before);
  });

  it("offers both opening Fronts at Kiel, without crossing a Front boundary (Ref 21.1, 21.2; R3)", () => {
    const s = position([fleet("g", "germany", "J30")], { activeSide: "axis", control: { K28: "germany", J35: "germany" } });
    const options = fleetMoveOptions(CTX, s, "g");
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: "K28", front: "western" }),
      expect.objectContaining({ to: "J35", front: "eastern" }),
    ]));
    expect(problem(position(), { to: "U22" })).toMatch(/Both ports/);
    expect(problem(position([fleet("b1", "britain", "V38")], { control: { J35: "britain" } }), { to: "J35", front: "eastern" })).toMatch(/No sea course/);
  });
});
