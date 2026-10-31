import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { allyDueToWake, interventionWake, MC9_INTERVENTION_WAKES, MC9_VALUE_ADDED_AT_ONCE, MC9_WAKE_AT_STEP_2, wakeAllies, wakeDateReached } from "../src/engine/minors-wake";
import type { GameState } from "../src/engine/types";
import { atWar } from "../src/engine/war";
import { atStart, CTX, ctxFor } from "./helpers";
import { inf } from "./helpers-move";

const allies = ["bulgaria", "finland", "hungary", "rumania"] as const;
const start = (): GameState => atStart(SCENARIO_1939, 1);
const due = (tweak: Partial<GameState> = {}): GameState => ({ ...start(), year: 1941, season: "summer", activeSide: "axis", position: { part: "player-turn", turn: 1, step: "2" }, ...tweak });
const attacked = (): GameState => ({ ...start(), countries: { hungary: { status: "attacked", attacker: "britain" } }, units: { g: inf("g", "germany", "S30") } });

// spec 15 R9 / MC9: automatic date, step timing and the three selected defaults.
describe("R9 wake date", () => {
  it("pins the defaults", () => {
    expect(MC9_WAKE_AT_STEP_2).toBe(true);
    expect(MC9_VALUE_ADDED_AT_ONCE).toBe(true);
    expect(MC9_INTERVENTION_WAKES).toBe(true);
  });
  it("requires Summer 1941 or later, an Axis turn and step 2 or later", () => {
    expect(wakeDateReached(due({ season: "spring" }))).toBe(false);
    expect(wakeDateReached(due({ activeSide: "allies" }))).toBe(false);
    expect(wakeDateReached(due({ position: { part: "player-turn", turn: 1, step: "1" } }))).toBe(false);
    expect(wakeDateReached(due())).toBe(true);
    expect(wakeDateReached(due({ year: 1942 }))).toBe(true);
    expect(wakeDateReached(due({ position: { part: "player-turn", turn: 1, step: "10b" } }))).toBe(true);
    expect(wakeDateReached(start())).toBe(false);
    expect(wakeDateReached(due({ position: null }))).toBe(false);
    expect(wakeDateReached(due({ position: { part: "year-start" } }))).toBe(false);
  });
  it("lists the four sleepers sorted, but no active or conquered allies", () => {
    expect(allyDueToWake(CTX, due())).toEqual(allies);
    expect(allyDueToWake(CTX, start())).toEqual([]);
    expect(allyDueToWake(ctxFor(SCENARIO_1942), atStart(SCENARIO_1942, 1))).toEqual([]);
    expect(allyDueToWake(CTX, due({ conquests: allies.map((country) => ({ country }) as never) }))).toEqual([]);
  });
});

// spec 15 R9 / Ref 17.3: immediate activation, free wars, values, exclusion and pure application.
describe("R9 waking effects", () => {
  it("wakes only named allies, credits their exact values and inherits wars for free", () => {
    const s = start();
    const before = structuredClone(s);
    const r = wakeAllies(CTX, s, ["rumania", "hungary", "hungary"]);
    expect(r.woken).toEqual(["hungary", "rumania"]);
    expect(r.brps).toBe(25);
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal + 25);
    expect(r.state.nations.germany.spent).toBe(s.nations.germany.spent);
    expect(r.state.nations.italy).toEqual(s.nations.italy);
    expect(r.state.minorAllies.filter((m) => m.active).map((m) => m.owner).sort()).toEqual(r.woken);
    for (const enemy of ["britain", "france", "poland"] as const) expect(atWar(r.state, "hungary", enemy)).toBe(true);
    expect(atWar(r.state, "hungary", "ussr")).toBe(false);
    expect(r.state.units).toEqual(s.units); // placement belongs to the next ticket
    expect(s).toEqual(before);
    const objects = (value: unknown): object[] => value !== null && typeof value === "object" ? [value, ...Object.values(value).flatMap(objects)] : [];
    const inputObjects = new Set(objects(s));
    expect(objects(r.state).some((o) => inputObjects.has(o))).toBe(false);
    expect(wakeAllies(CTX, s, ["hungary", "rumania"])).toEqual(r);
    const twice = wakeAllies(CTX, r.state, r.woken);
    expect(twice).toEqual({ state: r.state, woken: [], brps: 0 });
    expect(wakeAllies(CTX, s, [...allies]).brps).toBe(45);
  });
  it("skips Axis declarations and conquered sleepers", () => {
    const s = due({ countries: { hungary: { status: "attacked", attacker: "germany" }, finland: { status: "attacked", attacker: "italy" } }, conquests: [{ country: "rumania" } as never] });
    s.nations.italy.status = "axis";
    expect(allyDueToWake(CTX, s)).toEqual(["bulgaria"]);
    expect(wakeAllies(CTX, s, [...allies]).woken).toEqual(["bulgaria"]);
  });
});

// spec 15 R9 / MC9: an Allied attack needs German ground presence for an early wake.
describe("R9 Intervention", () => {
  it("requires an Allied attacker and German ground on the ally's land", () => {
    const s = attacked();
    expect(interventionWake(CTX, s)).toEqual(["hungary"]);
    expect(allyDueToWake(CTX, s)).toEqual([]);
    expect(interventionWake(CTX, { ...s, units: {} })).toEqual([]);
    for (const type of ["air", "fleet"] as const) expect(interventionWake(CTX, { ...s, units: { g: inf("g", "germany", "S30", 3, 3, type) } })).toEqual([]);
    expect(interventionWake(CTX, { ...s, units: { g: inf("g", "italy", "S30") } })).toEqual([]);
    expect(interventionWake(CTX, { ...s, units: { g: inf("g", "germany", "L31") } })).toEqual([]);
    expect(interventionWake(CTX, { ...s, countries: {} })).toEqual([]);
    expect(interventionWake(CTX, { ...s, conquests: [{ country: "hungary" } as never] })).toEqual([]);
    expect(interventionWake(CTX, wakeAllies(CTX, s, ["hungary"]).state)).toEqual([]);
    expect(interventionWake(CTX, s)).toEqual(interventionWake(CTX, structuredClone(s)));
    expect(allyDueToWake(CTX, due({ countries: s.countries }))).toEqual(allies);
  });
});
