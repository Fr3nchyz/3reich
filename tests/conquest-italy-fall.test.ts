import { describe, expect, it } from "vitest";
import { ISLANDS } from "../src/data/islands";
import { MAP } from "../src/data/map";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import type { GameEvent } from "../src/engine/action-types";
import type { Conquest } from "../src/engine/conquest-record";
import { conquestIncome } from "../src/engine/conquest-income";
import { chooseFleets, settleItalySurrender } from "../src/engine/conquest-italy-fall";
import { controllerOf } from "../src/engine/control";
import { isPort, portsOnFront } from "../src/engine/naval-ports";
import { rollD6 } from "../src/engine/rng";
import { advance } from "../src/engine/turn";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { ctxFor } from "./helpers";

// Spec 14 R6 / Ref 18.2, ticket 14-8; TODO(verify) V16: Italy's surrender at the end of the Axis Combat Phase and the German share of the fleet.
const ctx = ctxFor(SCENARIO_1944);
const STEP_7P = { part: "player-turn", turn: 2, step: "7p" } as const;
const rome = Object.values(MAP.hexes).find((h) => h.country === "italy" && h.name === "Rome")!.id;
const naples = Object.values(MAP.hexes).find((h) => h.country === "italy" && h.name === "Naples")!.id;
const italianPorts = Object.values(MAP.hexes).filter((h) => h.land && h.country === "italy" && isPort(ctx, h.id)).map((h) => h.id);
const MINORS = ["bulgaria", "hungary", "rumania", "finland", "yugoslavia", "greece", "spain", "turkey", "portugal", "sweden", "norway", "denmark", "belgium", "netherlands", "luxembourg", "poland"] as const;
/** Two Italian ports (and their fleets' berths) that stay Italian: they pass to Germany at the surrender. */
const NORTH = italianPorts.slice(0, 2);
const seedFor = (die: number): number => { for (let s = 1; s < 10000; s++) if (rollD6(s).roll === die) return s; throw new Error("no seed"); };

function position(tweak: Partial<GameState> = {}): GameState {
  const s = board([counter("a", "britain", "infantry", 2, naples, 3)], SCENARIO_1944, { year: 1943, season: "spring", firstSide: "allies", activeSide: "axis", position: STEP_7P, rngState: seedFor(3), ...tweak });
  s.nations.italy.status = "axis";
  // The Allies hold all the land but Rome (so Italy has not fallen by its capital, and their unit is supplied), Germany keeps Germany; the minor countries they would conquer are already conquered.
  for (const h of Object.values(MAP.hexes)) if (h.land) s.control[h.id] = h.id === rome || NORTH.includes(h.id) ? "italy" : h.country === "germany" ? "germany" : "britain";
  s.conquests = MINORS.map((country): Conquest => ({ country, by: "britain", side: "axis", how: "capital", at: { year: 1942, season: "winter" } }));
  for (const h of ISLANDS.sicily.hexes) s.control[h] = "britain";
  return s;
}
const withFleets = (s: GameState, strengths: number[]): GameState => {
  strengths.forEach((n, i) => { s.units[`f${i + 1}`] = counter(`f${i + 1}`, "italy", "fleet", n, NORTH[i % NORTH.length]!); });
  return s;
};
const types = (events: GameEvent[]) => events.map((e) => e.type);
const kept = (events: GameEvent[]) => events.find((e) => e.type === "ITALIAN_FLEET_KEPT") as Extract<GameEvent, { type: "ITALIAN_FLEET_KEPT" }>;
const italianShips = (s: GameState) => Object.values(s.units).filter((u) => u.type === "fleet");

describe("Italy surrenders at the end of the Axis Combat Phase (spec 14 R6)", () => {
  it("leaving 7p of the Axis Player Turn with the four conditions and Allied Initiative: Italy is conquered by Germany", () => {
    const r = advance(ctx, withFleets(position(), [4]));
    expect(r.state.nations.italy.status).toBe("conquered");
    expect(r.state.nations.italy.brpTotal).toBe(0);
    expect(r.state.conquests!.filter((c) => c.country === "italy")).toHaveLength(1);
    expect(r.state.conquests!.find((c) => c.country === "italy")).toMatchObject({ country: "italy", by: "germany", side: "axis", how: "italian-surrender", at: { year: 1943, season: "spring" } });
    expect(types(r.events)).toContain("COUNTRY_CONQUERED");
  });
  it("every Italian-held hex passes to Germany, and Italian units are removed", () => {
    const s = withFleets(position(), [4]);
    s.units.i = counter("i", "italy", "infantry", 3, "Z22", 3);
    const r = advance(ctx, s);
    for (const h of [rome, ...NORTH]) expect(controllerOf(ctx, r.state, h)).toBe("germany");
    expect(r.state.units.i).toBeUndefined();
  });
  it("Germany gets half of Italy's starting BRPs per Year Start Sequence while it holds Rome (the surrender counts as a conquest)", () => {
    const r = advance(ctx, position());
    expect(conquestIncome(ctx, r.state, "germany")).toBe(Math.floor(ctx.scenario.nations.italy.brpTotal / 2));
  });
  it("nothing happens in the Allied Combat Phase", () => {
    const r = advance(ctx, position({ activeSide: "allies" }));
    expect(r.state.nations.italy.status).toBe("axis");
    expect((r.state.conquests ?? []).filter((c) => c.country === "italy")).toHaveLength(0);
  });
  it("nothing happens when the Axis held the Initiative", () => {
    const r = advance(ctx, position({ firstSide: "axis" }));
    expect(r.state.nations.italy.status).toBe("axis");
  });
  it("nothing happens at any other step of the Axis turn", () => {
    for (const step of ["7h", "7j", "7o"] as const) expect(advance(ctx, position({ position: { part: "player-turn", turn: 2, step } })).state.nations.italy.status).toBe("axis");
  });
  it("nothing happens before Spring 1943, with an Axis unit in Africa, or with Sicily not held", () => {
    expect(advance(ctx, position({ year: 1942, season: "winter" })).state.nations.italy.status).toBe("axis");
    const africa = position();
    africa.units.g = counter("g", "germany", "infantry", 2, Object.values(MAP.hexes).find((h) => h.land && h.country === "libya")!.id, 3);
    expect(advance(ctx, africa).state.nations.italy.status).toBe("axis");
    const sicily = position();
    sicily.control[ISLANDS.sicily.hexes[0]!] = "germany";
    sicily.control[ISLANDS.sardinia.hexes[0]!] = "germany";
    expect(advance(ctx, sicily).state.nations.italy.status).toBe("axis");
  });
  it("a neutral or already conquered Italy does not surrender", () => {
    const neutral = position();
    neutral.nations.italy.status = "neutral";
    expect(settleItalySurrender(ctx, neutral).events).toEqual([]);
    const done = advance(ctx, position()).state;
    expect(settleItalySurrender(ctx, { ...done, activeSide: "axis" }).events).toEqual([]);
  });
  it("Rome taken as well: Italy falls to the capital rule and the surrender adds nothing (one conquest, not two)", () => {
    const s = position();
    s.units.g = counter("g", "britain", "infantry", 2, rome, 3);
    s.control[rome] = "britain";
    const r = advance(ctx, s);
    expect(r.state.conquests!.filter((c) => c.country === "italy")).toHaveLength(1);
  });
});

describe("the German share of the Italian fleet (V16)", () => {
  it("the die is rolled once from the game's generator and adds two", () => {
    const s = withFleets(position({ rngState: seedFor(3) }), [3, 3, 3]);
    const r = advance(ctx, s);
    expect(kept(r.events)).toMatchObject({ die: 3, available: 9, share: 5 });
    expect(r.state.rngState).toBe(rollD6(seedFor(3)).state);
  });
  it("is capped by the factors that existed", () => {
    const r = advance(ctx, withFleets(position({ rngState: seedFor(6) }), [2, 1]));
    expect(kept(r.events)).toMatchObject({ die: 6, available: 3, share: 3 });
  });
  it("the kept counters are German with Italian nationality, whole counters first and the last cut to fit, in German-held ports", () => {
    const r = advance(ctx, withFleets(position({ rngState: seedFor(1) }), [2, 2, 2]));
    const ships = italianShips(r.state);
    expect(ships.map((u) => [u.id, u.strength]).sort()).toEqual([["f1", 2], ["f2", 1]]);
    for (const u of ships) {
      expect(u.owner).toBe("germany");
      expect(u.nationality).toBe("italy");
      expect(isPort(ctx, u.at)).toBe(true);
      expect(controllerOf(ctx, r.state, u.at)).toBe("germany");
    }
    expect(kept(r.events)).toMatchObject({ share: 3, counters: 2, placed: 2 });
  });
  it("no Italian fleet: the die is still rolled and nothing is kept", () => {
    const r = advance(ctx, position());
    expect(kept(r.events)).toMatchObject({ available: 0, share: 0, counters: 0, placed: 0 });
    expect(italianShips(r.state)).toHaveLength(0);
  });
  it("the report comes after the fall's own events", () => {
    const t = types(advance(ctx, withFleets(position(), [3])).events);
    expect(t.indexOf("ITALIAN_FLEET_KEPT")).toBeGreaterThan(t.indexOf("COUNTRY_CONQUERED"));
  });
  it("chooseFleets takes counters by number and cuts the last", () => {
    const s = withFleets(position(), [2, 2, 2, 2]);
    expect(chooseFleets(s, 5).map((u) => u.strength)).toEqual([2, 2, 1]);
    expect(chooseFleets(s, 0)).toEqual([]);
  });
  it("Italian ships Germany already held with Italy's nationality are not part of the available factors", () => {
    const s = withFleets(position(), [2]);
    s.units.h = { ...counter("h", "germany", "fleet", 5, italianPorts[0]!), nationality: "italy" };
    expect(kept(advance(ctx, s).events).available).toBe(2);
  });
  it("a counter keeps its own port when it is German-held after the fall", () => {
    const s = withFleets(position({ rngState: seedFor(1) }), [1, 1]);
    const r = advance(ctx, s);
    expect(r.state.units.f1!.at).toBe(NORTH[0]);
    expect(r.state.units.f2!.at).toBe(NORTH[1]);
  });
  it("a counter with no German-held port with room on its Front is lost and not counted as placed", () => {
    const s = withFleets(position({ rngState: seedFor(1) }), [2, 2]);
    for (const h of portsOnFront(ctx, "mediterranean")) if (!NORTH.includes(h) && s.control[h] !== "britain") s.control[h] = "britain"; // no other German-held port on the Front
    NORTH.forEach((h, i) => { for (let k = 0; k < 4; k++) s.units[`g${i}${k}`] = counter(`g${i}${k}`, "germany", "fleet", 9, h); }); // a port holds 36 factors
    const r = advance(ctx, s);
    expect(kept(r.events)).toMatchObject({ counters: 2, placed: 0 });
    expect(italianShips(r.state).filter((u) => u.nationality === "italy")).toHaveLength(0);
  });
});

describe("what Italy held outside Italy (V16)", () => {
  it("an Italian-held hex in another country passes to Germany too, not to nobody", () => {
    const libya = Object.values(MAP.hexes).find((h) => h.land && h.country === "libya")!.id;
    const s = position();
    s.control[libya] = "italy";
    expect(controllerOf(ctx, advance(ctx, s).state, libya)).toBe("germany");
  });
});
