import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction } from "../src/engine/actions";
import { legalBuilds } from "../src/engine/construction";
import { eliminateUnits } from "../src/engine/losses";
import { fleetMayAct, grayUntil, markGray, turnWords } from "../src/engine/naval-record";
import { seaSupplyOptions, seaSupplyProblem } from "../src/engine/naval-supply-options";
import { freeCapacity } from "../src/engine/naval-supply";
import { navalOf } from "../src/engine/naval-record";
import type { GameState, Unit } from "../src/engine/types";
import { hexCard } from "../src/ui/hexCard";
import { board, counter } from "./board";
import { CTX, atStart } from "./helpers";

// Spec 17, ticket 17-3 (R5; TODO(verify) RB6 to RB8; Ref 11.62, 21.3): a fleet bought back from the pool is gray for four Game Turns.
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const fleet = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "fleet", 9, at);
const at8b = (units: Unit[]): GameState => {
  const s = atStart(SCENARIO_1939, 1);
  return { ...s, activeSide: "axis", position: { part: "player-turn", turn: 1, step: "8b" }, units: { ...s.units, ...Object.fromEntries(units.map((u) => [u.id, u])) }, nextUnitId: 900, year: 1940, season: "fall" };
};
/** Fall 1940, a German fleet sunk and bought back: the state after the BUILD and the new fleet's id. */
function rebuilt(): { s: GameState; id: string } {
  const lost = eliminateUnits(at8b([fleet("f1", "germany", "K28")]), ["f1"]).state;
  const b = legalBuilds(CTX, lost).find((a) => a.unit.type === "fleet" && a.unit.returned)!;
  const r = ok(applyAction(CTX, lost, b));
  return { s: r.state, id: Object.values(r.state.units).find((u) => u.type === "fleet" && !lost.units[u.id])!.id };
}
const when = (s: GameState, year: number, season: GameState["season"]): GameState => ({ ...s, year, season });

describe("a rebuilt fleet is gray for a year (RB6, Ref 11.62)", () => {
  it("buying a returned fleet records the first Game Turn it may act: four Game Turns later, Fall 1941", () => {
    const { s, id } = rebuilt();
    expect(s.grayFleets).toEqual({ [id]: { year: 1941, season: "fall" } });
    expect(turnWords(s.grayFleets![id]!)).toBe("Fall 1941");
  });

  it("is gray through Summer 1941 and acts in Fall 1941, at the year boundary and after", () => {
    const { s, id } = rebuilt();
    expect(grayUntil(s, id)).toEqual({ year: 1941, season: "fall" });
    expect(grayUntil(when(s, 1940, "winter"), id)).toBeDefined();
    expect(grayUntil(when(s, 1941, "spring"), id)).toBeDefined();
    expect(grayUntil(when(s, 1941, "summer"), id)).toBeDefined();
    expect(grayUntil(when(s, 1941, "fall"), id)).toBeUndefined();
    expect(grayUntil(when(s, 1942, "spring"), id)).toBeUndefined();
  });

  it("a fleet from the scenario's Allowable Builds is only new, not gray (RB8)", () => {
    const s = at8b([]);
    const b = legalBuilds(CTX, s).find((a) => a.unit.type === "fleet" && !a.unit.returned)!;
    const r = ok(applyAction(CTX, s, b));
    expect(r.state.grayFleets).toBeUndefined();
    const id = Object.values(r.state.units).find((u) => u.type === "fleet" && !s.units[u.id])!.id;
    expect(grayUntil(r.state, id)).toBeUndefined();
    expect(fleetMayAct(r.state, id)).toBe(false); // new: waits out the Game Turn (Ref 21.3)
  });

  it("fleetMayAct, the one query the later fleet actions must call, says no while gray even when nothing was used", () => {
    const { s, id } = rebuilt();
    const old = { ...when(s, 1941, "summer"), naval: undefined };
    expect(fleetMayAct(old, id)).toBe(false);
    expect(fleetMayAct(when(old, 1941, "fall"), id)).toBe(true);
  });

  it("only a fleet is marked: a returned infantry build leaves no record", () => {
    const lost = eliminateUnits(at8b([counter("g1", "germany", "infantry", 3, "M32", 3)]), ["g1"]).state;
    const b = legalBuilds(CTX, lost).find((a) => a.unit.type === "infantry" && a.unit.returned)!;
    expect(ok(applyAction(CTX, lost, b)).state.grayFleets).toBeUndefined();
  });
});

describe("a gray fleet is otherwise a normal unit (RB7)", () => {
  it("an entry for a unit that has left the map is ignored", () => {
    const { s, id } = rebuilt();
    const { [id]: _gone, ...units } = s.units;
    expect(grayUntil({ ...s, units }, id)).toBeUndefined();
  });

  it("it stays on the map and counts for the port's capacity", () => {
    const { s, id } = rebuilt();
    expect(s.units[id]).toBeDefined();
    const room = freeCapacity(s, []);
    expect(room(id)).toBe(9);
  });

  it("a state saved before the field existed has no gray fleet", () => {
    const s = at8b([fleet("f1", "germany", "K28")]);
    expect(s.grayFleets).toBeUndefined();
    expect(grayUntil(s, "f1")).toBeUndefined();
    expect(fleetMayAct(s, "f1")).toBe(true);
  });
});

describe("sea supply refuses a gray fleet and accepts it after the date (Ref 19.31, 11.62)", () => {
  const position = (year: number, season: GameState["season"], gray: boolean): GameState => {
    const base = board([]);
    const s = board([counter("i1", "italy", "infantry", 2, "AA19", 3), fleet("f1", "italy", "U22")], undefined, {
      nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } },
      year,
      season,
    });
    return gray ? { ...markGray({ ...s, year: 1940, season: "fall" }, "f1"), year, season } : s;
  };
  const d = { fleets: ["f1"], from: "U22", to: "AA19", units: ["i1"] };

  it("is valid when the fleet is not gray (the check is sound)", () => {
    expect(seaSupplyProblem(CTX, position(1941, "fall", false), "axis", d)).toBeNull();
    expect(seaSupplyOptions(CTX, position(1941, "fall", false), "axis")).toHaveLength(1);
  });

  it("refuses while gray, naming Ref 11.62 and the date, and offers nothing to the computer", () => {
    const s = position(1941, "summer", true);
    expect(seaSupplyProblem(CTX, s, "axis", d)).toMatch(/gray fleet.*Fall 1941.*Ref 11\.62/);
    expect(seaSupplyOptions(CTX, s, "axis")).toEqual([]);
  });

  it("allows it from the date on", () => {
    const s = position(1941, "fall", true);
    expect(seaSupplyProblem(CTX, s, "axis", d)).toBeNull();
    expect(seaSupplyOptions(CTX, s, "axis")).toHaveLength(1);
    expect(navalOf(s).used).toEqual({});
  });
});

describe("the hex card says when a rebuilt fleet may act again (Part C)", () => {
  it("shows the note while gray and drops it at the date", () => {
    const { s, id } = rebuilt();
    const at = s.units[id]!.at;
    const note = (st: GameState) => hexCard(CTX, st, at).counters.find((c) => c.key === id)!.notes;
    expect(note(s)).toContain("Rebuilt: cannot act until Fall 1941.");
    expect(note(when(s, 1941, "fall"))).not.toContain("Rebuilt: cannot act until Fall 1941.");
  });
});
