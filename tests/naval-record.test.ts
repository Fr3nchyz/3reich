import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction } from "../src/engine/actions";
import { flownOf, newAirTurn } from "../src/engine/air-record";
import { legalBuilds } from "../src/engine/construction";
import { FLEET_COUNTER_SIZES, hasUsed, heldAtStart, markUsed, navalOf, useOf, type NavalState } from "../src/engine/naval-record";
import type { GameState } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

// Spec 12 ticket 12-1 (R1, R5, C1; Ref 21.3, 11.62): the fleet record, uses per Game Turn, a built fleet is "new", counter sizes, held at the start.
const start = (): GameState => atStart(SCENARIO_1939, 1);
const at8b = (): GameState => ({ ...start(), position: { part: "player-turn", turn: 1, step: "8b" } });
const okOf = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const FRESH = (turn: string, gameTurn: string): NavalState => ({ gameTurn, turn, used: {}, triedIntercept: [], moved: [], supply: [] });

describe("the record, in the pattern of airOf", () => {
  it("a state with no record gets an empty one for the Player Turn now being played", () => {
    const s = start();
    expect(s.naval).toBeUndefined();
    expect(navalOf(s)).toEqual(FRESH(`${s.year}-${s.season}-${s.activeSide}`, `${s.year}-${s.season}`));
    expect(navalOf(s)).toEqual(FRESH("1939-fall-axis", "1939-fall"));
  });

  it("asking does not change the state, and a stored record for this Player Turn is returned as it is", () => {
    const s = start();
    navalOf(s);
    expect(s.naval).toBeUndefined();
    const rec: NavalState = { ...FRESH("1939-fall-axis", "1939-fall"), used: { f1: "supply" }, triedIntercept: ["f2"], moved: ["f3"], supply: [{ fleets: ["f1"], from: "U22", to: "AA19", units: ["u1"] }] };
    expect(navalOf({ ...s, naval: rec })).toBe(rec);
  });

  it("the other side's Player Turn of the same Game Turn keeps what was used and drops the lists", () => {
    const rec: NavalState = { ...FRESH("1939-fall-axis", "1939-fall"), used: { f1: "supply", f9: "new" }, triedIntercept: ["f2"], moved: ["f3"], supply: [{ fleets: ["f1"], from: "U22", to: "AA19", units: ["u1"] }] };
    const later = navalOf({ ...start(), activeSide: "allies", naval: rec });
    expect(later).toEqual({ ...FRESH("1939-fall-allies", "1939-fall"), used: { f1: "supply", f9: "new" } });
  });

  it("the next Game Turn, season or year, starts with nothing used", () => {
    const rec: NavalState = { ...FRESH("1939-fall-axis", "1939-fall"), used: { f1: "supply" }, moved: ["f3"] };
    expect(navalOf({ ...start(), season: "winter", naval: rec })).toEqual(FRESH("1939-winter-axis", "1939-winter"));
    expect(navalOf({ ...start(), year: 1940, naval: rec })).toEqual(FRESH("1940-fall-axis", "1940-fall"));
  });

  it("a record that is not well formed is replaced by an empty one, never thrown at", () => {
    const s = start();
    const good = FRESH("1939-fall-axis", "1939-fall");
    const bad = (naval: unknown): GameState => ({ ...s, naval: naval as NavalState });
    expect(navalOf(bad({ ...good, moved: "x" }))).toEqual(good);
    expect(navalOf(bad({ ...good, triedIntercept: [1] }))).toEqual(good);
    expect(navalOf(bad({ ...good, supply: undefined }))).toEqual(good);
    expect(navalOf(bad({ ...good, used: undefined }))).toEqual(good);
    expect(navalOf(bad({ ...good, used: null }))).toEqual(good);
    expect(navalOf(bad({}))).toEqual(good);
    expect(navalOf(bad(null))).toEqual(good);
  });
});

describe("uses per Game Turn (R5)", () => {
  it("marking a fleet records its use, keeps the others, and leaves the old state alone", () => {
    const s = start();
    const a = markUsed(s, ["f1", "f2"], "supply");
    expect(s.naval).toBeUndefined();
    expect(navalOf(a).used).toEqual({ f1: "supply", f2: "supply" });
    const b = markUsed(a, ["f3"], "intercept");
    expect(navalOf(b).used).toEqual({ f1: "supply", f2: "supply", f3: "intercept" });
    expect(navalOf(a).used).toEqual({ f1: "supply", f2: "supply" });
    expect(useOf(b, "f3")).toBe("intercept");
    expect(useOf(b, "f1")).toBe("supply");
    expect(useOf(b, "f4")).toBeUndefined();
  });

  it("hasUsed is true for any use, built-this-turn included, and false for a fleet nothing is recorded for", () => {
    const s = markUsed(markUsed(markUsed(start(), ["a"], "mission"), ["b"], "escort"), ["c"], "new");
    expect(["a", "b", "c"].map((id) => hasUsed(s, id))).toEqual([true, true, true]);
    expect(hasUsed(s, "d")).toBe(false);
    expect(hasUsed(start(), "a")).toBe(false);
  });

  it("an id that is a property of every object is not a use", () => {
    const s = markUsed(start(), ["f1"], "supply");
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(useOf(s, id), id).toBeUndefined();
      expect(hasUsed(s, id), id).toBe(false);
    }
  });

  it("both Player Turns of a Game Turn share the use; the next Game Turn is clean (Ref 21.3, N7)", () => {
    const axis = markUsed(start(), ["f1"], "intercept");
    const allies = { ...axis, activeSide: "allies" as const };
    expect(hasUsed(allies, "f1")).toBe(true);
    expect(hasUsed({ ...allies, season: "winter" }, "f1")).toBe(false);
    expect(hasUsed({ ...axis, season: "winter", activeSide: "axis" }, "f1")).toBe(false);
  });

  it("marking after a Player Turn changed carries the use over and starts the lists afresh", () => {
    const axis = markUsed({ ...start(), naval: { ...FRESH("1939-fall-axis", "1939-fall"), moved: ["f3"] } }, ["f1"], "supply");
    const next = markUsed({ ...axis, activeSide: "allies" }, ["f2"], "mission");
    expect(next.naval).toEqual({ ...FRESH("1939-fall-allies", "1939-fall"), used: { f1: "supply", f2: "mission" } });
  });
});

describe("a fleet built in a Game Turn is new (Ref 21.3)", () => {
  const buildOf = (type: "fleet" | "air" | "infantry") => legalBuilds(CTX, at8b()).find((b) => b.unit.type === type)!;

  it("building a fleet marks it new for this Game Turn only", () => {
    const s = at8b();
    const b = buildOf("fleet");
    expect(b).toBeDefined();
    const built = okOf(applyAction(CTX, s, b)).state;
    const id = Object.values(built.units).find((u) => u.type === "fleet" && !s.units[u.id])!.id;
    expect(useOf(built, id)).toBe("new");
    expect(hasUsed(built, id)).toBe(true);
    expect(hasUsed({ ...built, activeSide: "allies" }, id)).toBe(true); // the other Player Turn of the same Game Turn
    expect(hasUsed({ ...built, season: "winter" }, id)).toBe(false); // the next Game Turn it may act
    expect(flownOf(built).units[id]).toBeUndefined(); // an air record is not touched
  });

  it("building anything else marks no fleet, and air is still marked in the air record", () => {
    const s = at8b();
    const inf = okOf(applyAction(CTX, s, buildOf("infantry"))).state;
    expect(inf.naval).toBeUndefined();
    const air = okOf(applyAction(CTX, s, buildOf("air"))).state;
    expect(air.naval).toBeUndefined();
    expect(Object.values(flownOf(air).units)).toEqual(["new"]);
  });

  it("a build that is refused marks nothing", () => {
    const s = at8b();
    const b = buildOf("fleet");
    const r = applyAction(CTX, s, { ...b, at: "M34" });
    expect(r.ok).toBe(false);
    expect(s.naval).toBeUndefined();
  });

  it("fleets that were on the map at setup are not new", () => {
    const s = at8b();
    const fleets = Object.values(s.units).filter((u) => u.type === "fleet");
    for (const f of fleets) expect(hasUsed(s, f.id)).toBe(false);
  });
});

describe("partial fleet counter sizes (R1, N1)", () => {
  it("are 1, 2, 6 and 9: the manual's example turns two 6-factor fleets into a 9, a 2 and a 1", () => {
    expect([...FLEET_COUNTER_SIZES]).toEqual([1, 2, 6, 9]);
    expect(12).toBe([9, 2, 1].reduce((a, b) => a + b, 0));
    for (const n of [9, 2, 1]) expect(FLEET_COUNTER_SIZES).toContain(n);
  });
});

describe("held at the start of the turn (Ref 20.2, 21.2)", () => {
  it("reads the control copied when the Player Turn began, not control as it stands", () => {
    const s = start();
    const hex = "M35"; // Warsaw, Polish at the start
    expect(heldAtStart(CTX, s, "allies", hex)).toBe(true);
    expect(heldAtStart(CTX, s, "axis", hex)).toBe(false);
    // Germany takes it during the turn: control changes, the copy taken at the start does not.
    const during = { ...s, air: newAirTurn(s), control: { ...s.control, [hex]: "germany" as const } };
    expect(heldAtStart(CTX, during, "allies", hex)).toBe(true);
    expect(heldAtStart(CTX, during, "axis", hex)).toBe(false);
    // A copy taken after the capture says German.
    const after = { ...during, air: newAirTurn(during) };
    expect(heldAtStart(CTX, after, "axis", hex)).toBe(true);
    expect(heldAtStart(CTX, after, "allies", hex)).toBe(false);
  });
});
