import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { hasSrWork } from "../src/engine/sr-action";
import { srOf } from "../src/engine/sr-record";
import { settle } from "../src/engine/turn";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 16 R18 to R20, C1, C3, C4, C5 (Ref 11.72, Ops 5.48e): step 9e waits while the side can redeploy a unit; SR_UNITS moves ground units and
// Replacements within the nation's allowance; END_STEP stays legal. 1939 map: Berlin L31, Munich Q27, Rome Y22.
const inf = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "infantry", 2, at, 3);
const at9e = (units: Unit[], tweak: Partial<GameState> = {}): GameState =>
  board(units, undefined, { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "9e" }, ...tweak });
const withItaly = (units: Unit[], tweak: Partial<GameState> = {}): GameState => {
  const s = board([]);
  return at9e(units, { nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" } }, ...tweak });
};
const sr = (state: GameState, units: string[], to: string): Action => ({ type: "SR_UNITS", side: state.activeSide, units, to });
const isSr = (a: Action) => a.type === "SR_UNITS";
const used = (state: GameState, n: number): Partial<GameState> => ({ sr: { turn: `${state.year}-${state.season}-axis`, used: { germany: n }, moved: [], escorted: {} } });

describe("step 9e waits only while a unit can be redeployed (C5)", () => {
  it("waits for a side with a unit that can go; the redeployments and moving on are listed", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    expect(hasSrWork(CTX, s)).toBe(true);
    expect(settle(CTX, s).state).toBe(s);
    const legal = legalActions(CTX, s);
    expect(legal.filter(isSr).length).toBeGreaterThan(10);
    expect(legal).toContainEqual({ type: "END_STEP", side: "axis", step: "9e" });
    expect(legal).toContainEqual(sr(s, ["g1"], "Q27"));
  });

  it("redeploying is optional: a human or the computer ends the step and the game moves on", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    const r = applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "9e" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.position).not.toEqual(s.position);
  });

  it("is passed with no unit of the side on the map, or with the nation's allowance used up", () => {
    const empty = at9e([]);
    expect(settle(CTX, empty).state.position).not.toEqual(empty.position);
    const spent = at9e([inf("g1", "germany", "L31")]);
    const done = { ...spent, ...used(spent, 9) };
    expect(hasSrWork(CTX, done)).toBe(false);
    expect(settle(CTX, done).state.position).not.toEqual(spent.position);
  });

  it("is passed when every unit is next to an enemy (cut off from redeploying)", () => {
    const s = at9e([inf("g1", "germany", "L33"), inf("p1", "poland", "M33")]);
    expect(hasSrWork(CTX, s)).toBe(false);
  });

  it("a Replacement can be redeployed: this is how reinforcements reach the front (R19)", () => {
    const s = at9e([counter("r1", "germany", "replacement", 1, "Q27")]);
    expect(legalActions(CTX, s)).toContainEqual(sr(s, ["r1"], "L31"));
  });

  it("a stack is listed as one redeployment; a subset of it is not listed but is accepted", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "L31")]);
    const legal = legalActions(CTX, s);
    expect(legal).toContainEqual(sr(s, ["g1", "g2"], "Q27"));
    expect(legal).not.toContainEqual(sr(s, ["g1"], "Q27"));
    expect(applyAction(CTX, s, sr(s, ["g1"], "Q27")).ok).toBe(true);
  });
});

describe("SR_UNITS (R18 to R20, C4)", () => {
  it("moves the unit, charges its nation one, records it and says so", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    const r = applyAction(CTX, s, sr(s, ["g1"], "Q27"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.units.g1!.at).toBe("Q27");
    expect(r.state.sr).toMatchObject({ used: { germany: 1 }, moved: ["g1"] });
    expect(r.events).toContainEqual({ type: "UNITS_REDEPLOYED", units: ["g1"], from: "L31", to: "Q27", nation: "germany", left: 8 });
  });

  it("a stack counts one a unit, whatever its size; one event for each nation and starting hex", () => {
    const s = at9e([inf("g1", "germany", "L31"), counter("g2", "germany", "infantry", 4, "Q27", 3)]);
    const r = applyAction(CTX, s, sr(s, ["g1", "g2"], "M31"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.sr!.used).toEqual({ germany: 2 });
    expect(r.events.filter((e) => e.type === "UNITS_REDEPLOYED")).toEqual([
      { type: "UNITS_REDEPLOYED", units: ["g1"], from: "L31", to: "M31", nation: "germany", left: 7 },
      { type: "UNITS_REDEPLOYED", units: ["g2"], from: "Q27", to: "M31", nation: "germany", left: 7 },
    ]);
    const two = at9e([inf("g1", "germany", "L31"), counter("g2", "germany", "infantry", 4, "L31", 3)]);
    const together = applyAction(CTX, two, sr(two, ["g1", "g2"], "M31"));
    expect(together.ok && together.events.filter((e) => e.type === "UNITS_REDEPLOYED")).toEqual([{ type: "UNITS_REDEPLOYED", units: ["g1", "g2"], from: "L31", to: "M31", nation: "germany", left: 7 }]);
  });

  it("each nation has its own allowance: Italy's 5 is not Germany's 9, and nothing is handed on", () => {
    const base = withItaly([inf("g1", "germany", "L31"), inf("i1", "italy", "Y22")]);
    const s = { ...base, ...used(base, 9) };
    expect(applyAction(CTX, s, sr(s, ["g1"], "Q27")).ok).toBe(false);
    expect(applyAction(CTX, s, sr(s, ["i1"], "Y23")).ok).toBe(true);
    const m = withItaly([inf("i1", "italy", "Y22")], { sr: { turn: "1939-fall-axis", used: { italy: 5 }, moved: [], escorted: {} } });
    expect(applyAction(CTX, m, sr(m, ["i1"], "Y23")).ok).toBe(false);
  });

  it("the last redeployment of the allowance refuses the next, and the step is passed once nothing more can go", () => {
    const base = at9e([inf("g1", "germany", "L31")]);
    const s = { ...base, ...used(base, 8) };
    const r = applyAction(CTX, s, sr(s, ["g1"], "Q27"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.position).not.toEqual(s.position); // germany has 0 left and nothing else of the side can go
    expect(r.events.some((e) => e.type === "STEPS_PASSED")).toBe(true);
  });

  it("a unit is redeployed once a Player Turn (AER28)", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "Q27")]);
    const r = applyAction(CTX, s, sr(s, ["g1"], "M31"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.position).toEqual(s.position); // g2 can still go
    expect(applyAction(CTX, r.state, sr(r.state, ["g1"], "L31")).ok).toBe(false);
    expect(legalActions(CTX, r.state).filter(isSr).every((a) => a.type === "SR_UNITS" && !a.units.includes("g1"))).toBe(true);
  });

  it("refuses the wrong side, the wrong step, a Sea Escort (16-21), an unreachable hex, a stranger and a malformed action", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("p1", "poland", "M33")]);
    expect(applyAction(CTX, s, { type: "SR_UNITS", side: "allies", units: ["g1"], to: "Q27" }).ok).toBe(false);
    expect(applyAction(CTX, { ...s, position: { part: "player-turn", turn: 1, step: "6f" } }, sr(s, ["g1"], "Q27")).ok).toBe(false);
    expect(applyAction(CTX, s, { ...sr(s, ["g1"], "Q27"), escort: "f1" } as Action).ok).toBe(false);
    expect(applyAction(CTX, s, sr(s, ["g1"], "M33")).ok).toBe(false);
    expect(applyAction(CTX, s, sr(s, ["g9"], "Q27")).ok).toBe(false);
    expect(applyAction(CTX, s, sr(s, ["p1"], "Q27")).ok).toBe(false);
    expect(applyAction(CTX, s, sr(s, [], "Q27")).ok).toBe(false);
    expect(applyAction(CTX, s, { type: "SR_UNITS", side: "axis", units: "g1", to: "Q27" } as unknown as Action).ok).toBe(false);
    expect(applyAction(CTX, s, { type: "SR_UNITS", side: "axis", units: [1], to: "Q27" } as unknown as Action).ok).toBe(false);
  });

  it("does not end next to an enemy or overstacked", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("p1", "poland", "M33")]);
    expect(applyAction(CTX, s, sr(s, ["g1"], "L33")).ok).toBe(false); // next to Poland's unit
    const crowd = at9e([inf("g1", "germany", "L31"), inf("a", "germany", "Q27"), inf("b", "germany", "Q27"), inf("c", "germany", "Q27")]);
    expect(applyAction(CTX, crowd, sr(crowd, ["g1"], "Q27")).ok).toBe(false);
  });
});

describe("the record (C1)", () => {
  it("an old saved game without it reads as nothing happened; a record of another Player Turn is not this one's", () => {
    const s = at9e([inf("g1", "germany", "L31")]);
    expect(s.sr).toBeUndefined();
    expect(srOf(s)).toEqual({ turn: "1939-fall-axis".replace("fall", s.season).replace("1939", String(s.year)), used: {}, moved: [], escorted: {} });
    const stale = { ...s, sr: { turn: "1900-spring-allies", used: { germany: 9 }, moved: ["g1"], escorted: {} } };
    expect(srOf(stale).used).toEqual({});
    expect(hasSrWork(CTX, stale)).toBe(true);
  });

  it("is replayable: the same actions give the same state and events", () => {
    const s = at9e([inf("g1", "germany", "L31"), inf("g2", "germany", "Q27")]);
    const actions: Action[] = [sr(s, ["g1"], "M31"), sr(s, ["g2"], "L31")];
    const a = replay(CTX, s, actions);
    const b = replay(CTX, s, actions);
    expect(a).toEqual(b);
    expect(a.state.sr!.used).toEqual({ germany: 2 });
  });
});
