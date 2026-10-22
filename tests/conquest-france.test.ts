import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { VICHY_FRANCE } from "../src/data/zones";
import { applyAction, replay } from "../src/engine/actions";
import type { GameEvent } from "../src/engine/action-types";
import { capitalState, fall, fallingNow, settleConquests } from "../src/engine/conquest";
import { franceMark, franceSteps, FRENCH_COLONIES, halve, vichyHexes } from "../src/engine/conquest-france";
import { conquestIncome } from "../src/engine/conquest-income";
import { controllerOf, sideInWar } from "../src/engine/control";
import { objectiveStandings } from "../src/engine/objectives";
import { overstacks } from "../src/engine/stacking";
import { rollD6 } from "../src/engine/rng";
import { advance } from "../src/engine/turn";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { declarationTargets } from "../src/engine/war";
import { runYearStartSequence } from "../src/engine/yearstart";
import { runGame } from "../scripts/selfplay/runner";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 14 ticket 14-7 (R5; Ref 18.3, 35.0; PC README rule 49.6): France falls when Paris is German-held at the end of the Allied Combat Phase, and Vichy France
// is created. TODO(verify) V13 to V15 (halving, colonies, French conquests) and V38 to V41 (the readings listed in docs/RULES.md).

const PARIS = "O22";
const MARSEILLES = "V19";
const LYONS = "S21";
const VICHY = "R20";
const AJACCIO = "X20";
const STEP_7P = { part: "player-turn", turn: 1, step: "7p" } as const;
const VICHY_ZONE = new Set(vichyHexes(CTX));

const hexesOf = (country: string): string[] => Object.values(MAP.hexes).filter((h) => h.land && h.country === country).map((h) => h.id);
const SYRIA = hexesOf("lebanon-syria");
const AFRICA = ["tunisia", "algeria", "morocco"].flatMap(hexesOf);

/** Two colony dice, Lebanon-Syria first, from a seed: a state's `rngState` that rolls these parities (even = Vichy, odd = Free French). */
function rngFor(syriaEven: boolean, africaEven: boolean): number {
  for (let seed = 1; seed < 10000; seed++) {
    const a = rollD6(seed);
    const b = rollD6(a.state);
    if ((a.roll % 2 === 0) === syriaEven && (b.roll % 2 === 0) === africaEven) return seed;
  }
  throw new Error("no seed");
}

let n = 0;
const unit = (owner: ForceOwner, type: UnitType, strength: number, at: string, movement?: number): Unit => counter(`t${++n}`, owner, type, strength, at, movement);
const inf = (owner: ForceOwner, at: string, strength = 2): Unit => unit(owner, "infantry", strength, at, 3);

/** The end of the Allied Combat Phase of Spring 1940 with a German unit in Paris and these counters (Germany first, as in the opening). */
function paris(units: Unit[], tweak: Partial<GameState> = {}): GameState {
  return board([inf("germany", PARIS, 3), ...units], SCENARIO_1939, { year: 1940, season: "spring", firstSide: "axis", activeSide: "allies", position: STEP_7P, control: { [PARIS]: "germany" }, rngState: rngFor(true, false), ...tweak });
}
const falls = (s: GameState) => fall(CTX, s, "france", "germany");
const ofType = (events: GameEvent[], type: GameEvent["type"]) => events.filter((e) => e.type === type);
const vichyEvent = (events: GameEvent[]) => ofType(events, "VICHY_CREATED")[0] as Extract<GameEvent, { type: "VICHY_CREATED" }>;
const owned = (s: GameState, owner: ForceOwner) => Object.values(s.units).filter((u) => u.owner === owner);

describe("the Vichy zone for the 1939 scenarios (the data)", () => {
  it("the 1939 scenario and the Campaign have the 17 Vichy hexes of the 1942 scenario and Corsica, in the same order", () => {
    for (const sc of [SCENARIO_1939, SCENARIO_CAMPAIGN]) {
      expect(sc.zones["vichy-france"]!.hexes).toHaveLength(17);
      expect(sc.zones["vichy-france"]).toEqual(SCENARIO_1942.zones["vichy-france"]);
      expect(sc.zones.corsica!.hexes).toEqual([AJACCIO]);
      expect(vichyHexes(ctxFor(sc))).toHaveLength(18);
    }
    expect(SCENARIO_1942.zones["vichy-france"]).toBe(VICHY_FRANCE);
  });
  it("Vichy and Corsica are land of France that nobody sets up in 1939; Marseilles and Lyons are in the zone, Paris is not", () => {
    expect(vichyHexes(CTX)).toContain(MARSEILLES);
    expect(vichyHexes(CTX)).toContain(LYONS);
    expect(vichyHexes(CTX)).toContain(VICHY);
    expect(vichyHexes(CTX)).not.toContain(PARIS);
    expect(vichyHexes(CTX).every((h) => MAP.hexes[h]!.country === "france" && MAP.hexes[h]!.land)).toBe(true);
    expect(Object.keys(SCENARIO_1939.forces)).not.toContain("vichy-france"); // nothing is set up there
  });
  it("the 1944 scenario has Corsica only (France is out there and never falls)", () => {
    expect(vichyHexes(ctxFor(SCENARIO_1944))).toEqual(SCENARIO_1944.zones.corsica!.hexes);
  });
});

describe("when France falls (R5: the end of the ALLIED Combat Phase)", () => {
  it("Paris taken in the Axis turn: France falls when the Allied Combat Phase ends, not before", () => {
    const s = paris([inf("france", "M24")]);
    expect(fallingNow(CTX, s, "axis")).toEqual([]);
    expect(advance(CTX, { ...s, activeSide: "axis" }).state.nations.france.status).toBe("allied");
    expect(fallingNow(CTX, s, "allies")).toEqual(["france"]);
    const r = advance(CTX, s);
    expect(r.state.nations.france.status).toBe("vichy");
    expect(types(r.events)).toContain("VICHY_CREATED");
  });
  it("Paris taken back by France in its own Combat Phase: France stands (it has exactly one Combat Phase)", () => {
    const s = paris([inf("france", PARIS)], { control: { [PARIS]: "france" }, units: { g: inf("germany", "O23") } });
    const r = advance(CTX, s);
    expect(r.state.nations.france.status).toBe("allied");
    expect(r.state.conquests).toBeUndefined();
  });
  it("the conqueror is the owner of the unit that holds Paris (an Italian unit gives France's land to Italy)", () => {
    const s = paris([inf("france", "M24")], { control: { [PARIS]: "italy" }, nations: { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" } } });
    const r = settleConquests(CTX, s);
    expect(r.state.conquests![0]).toMatchObject({ country: "france", by: "italy" });
    expect(controllerOf(CTX, r.state, "M24")).toBe("italy");
  });
  it("France in the 1942 and 1944 scenarios (Vichy, out) is never conquered by a unit in Paris", () => {
    for (const sc of [SCENARIO_1942, SCENARIO_1944]) {
      const s = board([inf("germany", PARIS, 3)], sc, { year: 1943, season: "spring", firstSide: "axis", activeSide: "allies", position: STEP_7P, control: { [PARIS]: "germany" } });
      expect(capitalState(ctxFor(sc), s, "france")).toBe("free");
      expect(settleConquests(ctxFor(sc), s).events).toEqual([]);
    }
  });
});

const types = (events: GameEvent[]) => events.map((e) => e.type);

describe("the nations after the fall (R5 points 4 and 6)", () => {
  const r = falls(paris([inf("france", "M24")]));
  it("France has the status 'vichy', no BRPs and no Base (as in the 1942 scenario); it is not a target of a declaration of war", () => {
    expect(r.state.nations.france).toMatchObject({ status: "vichy", brpBase: 0, brpTotal: 0, spendLimit: 0, spent: 0 });
    expect(declarationTargets(CTX, { ...r.state, activeSide: "axis" }, "germany")).not.toContain("france");
    expect(sideInWar(r.state, "vichy-france")).toBeNull();
  });
  it("the Conquest is recorded like any Power's, with the BRPs France began with and the Game Turn", () => {
    expect(r.state.conquests).toEqual([{ country: "france", by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "spring" }, startingBrps: 85 }]);
    expect(capitalState(CTX, r.state, "france")).toBe("conquered");
  });
  it("Vichy France is an inactive German Minor-Ally, added once; the Vichy and Free French have an empty Force Pool; France's own pool is gone", () => {
    expect(r.state.minorAllies).toEqual([{ owner: "vichy-france", of: "germany", active: false }]);
    expect(r.state.pools["vichy-france"]).toEqual({ forcePool: [], allowableBuilds: [] });
    expect(r.state.pools["free-france"]).toEqual({ forcePool: [], allowableBuilds: [] });
    expect(r.state.pools.france).toBeUndefined();
    expect(franceMark(r.state).minorAllies).toHaveLength(1); // not added twice
  });
  it("Germany gets half of 85 in a later Year Start Sequence while it holds Paris, and Vichy France pays it nothing; France gets nothing", () => {
    const next = { ...r.state, year: 1941, season: "spring" as const };
    expect(conquestIncome(CTX, next, "germany")).toBe(42);
    const yss = runYearStartSequence(CTX, next).state;
    const plain = runYearStartSequence(CTX, { ...next, conquests: [] }).state;
    expect(yss.nations.germany.brpTotal - plain.nations.germany.brpTotal).toBe(42);
    expect(yss.nations.france.brpTotal).toBe(0);
    expect(yss.nations.france.brpBase).toBe(0);
  });
  it("Marseilles and Lyons, the Objectives of the Vichy zone, count for the Axis (Ref 35.0); Paris, as a German hex, too", () => {
    const before = objectiveStandings(CTX, paris([]));
    const after = objectiveStandings(CTX, r.state);
    expect(before.allies).toEqual(expect.arrayContaining([MARSEILLES, LYONS]));
    expect(after.axis).toEqual(expect.arrayContaining([MARSEILLES, LYONS, PARIS]));
  });
});

describe("the land (R5 points 1 and 4)", () => {
  it("every Vichy hex becomes Vichy-controlled, Corsica too, whoever held it; the rest of European France and the hexes France held elsewhere pass to the conqueror", () => {
    const belgium = hexesOf("belgium")[0]!;
    const s = paris([], { control: { [belgium]: "france", [LYONS]: "germany", [MARSEILLES]: "britain" }, rngState: rngFor(false, false) }); // both colonies Free French: only the zone is Vichy
    const r = falls(s);
    for (const h of VICHY_ZONE) expect(controllerOf(CTX, r.state, h), h).toBe("vichy-france");
    expect(controllerOf(CTX, r.state, "M24")).toBe("germany");
    expect(controllerOf(CTX, r.state, belgium)).toBe("germany"); // a French conquest becomes Axis (V15, first slice)
    const vichy = r.events.filter((e) => e.type === "CONTROL_PASSED" && e.to === "vichy-france");
    expect(vichy).toHaveLength(1);
    expect((vichy[0] as Extract<GameEvent, { type: "CONTROL_PASSED" }>).hexes).toEqual([...VICHY_ZONE].sort());
  });
  it("the French hexes of Vichy France are not also passed to the conqueror (no hex listed twice)", () => {
    const r = falls(paris([]));
    const toGermany = r.events.filter((e) => e.type === "CONTROL_PASSED" && e.to === "germany").flatMap((e) => (e as Extract<GameEvent, { type: "CONTROL_PASSED" }>).hexes);
    expect(toGermany.some((h) => VICHY_ZONE.has(h))).toBe(false);
    expect(toGermany).toContain("M24");
  });
});

describe("the French units are halved (R5 point 2, V13, V38)", () => {
  const french = (type: UnitType, strength: number, id: string): Unit => ({ id, owner: "france", type, strength, at: "M24", ...(type === "air" || type === "fleet" ? {} : { movement: 3 }) });
  it("ground counters: half of each kind, rounded up, the lowest numbers first (3 → 2, 2 → 1, 1 → 1); a 2-3 and a 3-4 are different kinds", () => {
    const a = [french("infantry", 2, "u1"), french("infantry", 2, "u2"), french("infantry", 2, "u3")];
    const b = [{ ...french("infantry", 2, "u4"), strength: 3, movement: 4 }, { ...french("infantry", 2, "u5"), strength: 3, movement: 4 }];
    const c = [french("armor", 3, "u6")];
    expect(halve([...a, ...b, ...c]).keep.map((u) => u.id)).toEqual(["u1", "u2", "u4", "u6"]);
    expect(halve([...a, ...b, ...c]).lose.map((u) => u.id)).toEqual(["u3", "u5"]);
  });
  it("air and naval counters: the factors of the type are totalled and half, rounded up, is the least Vichy gets (5+5+5 → 2 counters; 5+5 → 1; 5 → 1; 9+9+9 → 2)", () => {
    const air = (ids: string[]) => ids.map((id) => french("air", 5, id));
    expect(halve(air(["u1", "u2", "u3"])).keep.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(halve(air(["u1", "u2"])).keep.map((u) => u.id)).toEqual(["u1"]);
    expect(halve(air(["u1"])).keep.map((u) => u.id)).toEqual(["u1"]);
    expect(halve(["u1", "u2", "u3"].map((id) => french("fleet", 9, id))).keep.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(halve([french("air", 5, "u1"), french("fleet", 9, "u2")]).keep.map((u) => u.id)).toEqual(["u1", "u2"]); // air and fleets are totalled apart
    expect(halve([french("air", 1, "u1"), french("air", 5, "u2"), french("air", 1, "u3")]).keep.map((u) => u.id)).toEqual(["u1", "u2"]); // 7 factors, 4 wanted: 1, then 5
  });
  it("airbases and bridgeheads are lost; nothing is kept from nothing", () => {
    expect(halve([french("airbase", 0, "u1"), french("bridgehead", 0, "u2")]).keep).toEqual([]);
    expect(halve([])).toEqual({ keep: [], lose: [] });
  });
  it("in play: the Vichy half stands in the Vichy hexes as Vichy units with their own numbers, the other half is gone, and the event counts both", () => {
    const units = [1, 2, 3, 4, 5].map((i) => ({ ...french("infantry", 2, `f${i}`), at: "M24" }));
    const r = falls(paris(units, { units: { ...paris([]).units, ...Object.fromEntries(units.map((u) => [u.id, u])) } }));
    const vichy = owned(r.state, "vichy-france");
    expect(vichy.map((u) => u.id).sort()).toEqual(["f1", "f2", "f3"]);
    expect(vichy.every((u) => VICHY_ZONE.has(u.at))).toBe(true);
    expect(owned(r.state, "france")).toEqual([]);
    expect(vichyEvent(r.events).halved).toEqual({ kept: 3, lost: 2 });
    const removed = ofType(r.events, "UNITS_REMOVED_BY_CONQUEST")[0] as Extract<GameEvent, { type: "UNITS_REMOVED_BY_CONQUEST" }>;
    expect(removed.units.map((u) => u.id).sort()).toEqual(["f4", "f5"]);
  });
  it("they are set up in map order, the first hex of the zone that fits: two ground counters a hex, air in a city, fleets in a port, and never in a hex that holds an Allied counter", () => {
    const ground = [1, 2, 3, 4, 5, 6].map((i) => ({ ...french("infantry", 2, `f${i}`), at: "M24" })); // keep 3
    const air = { ...french("air", 5, "a1"), at: "M24" };
    const fleet = { ...french("fleet", 9, "s1"), at: "M24" };
    const first = vichyHexes(CTX);
    const block = unit("usa", "infantry", 2, first[0]!, 3); // an Allied counter in the first hex
    const r = falls(paris([...ground, air, fleet, block]));
    const at = (id: string) => r.state.units[id]!.at;
    expect([at("f1"), at("f2"), at("f3")]).toEqual([first[1], first[1], first[2]]);
    expect(MAP.hexes[at("a1")]!.features.some((f) => f === "city" || f === "capital" || f === "port" || f === "capital-port")).toBe(true);
    expect(at("a1")).toBe(first.find((h) => MAP.hexes[h]!.features.includes("city")));
    expect(MAP.hexes[at("s1")]!.features.some((f) => f === "port" || f === "capital-port")).toBe(true);
    expect(r.state.units[block.id]).toBeDefined(); // the Allied counter stays
    expect(overstacks(CTX, r.state)).toEqual([]);
  });
  it("a Vichy counter with no room in the zone is lost with France (German counters fill the hexes), and the event says so", () => {
    const germans = [...vichyHexes(CTX)].flatMap((h) => [inf("germany", h), inf("germany", h)]);
    const r = falls(paris([french("infantry", 2, "f1"), french("infantry", 2, "f2")].map((u) => ({ ...u, at: "M24" })).concat(germans)));
    expect(owned(r.state, "vichy-france")).toEqual([]);
    expect(vichyEvent(r.events).halved).toEqual({ kept: 0, lost: 2 });
  });
  it("French units that are not in European France or a colony are lost with France: in Belgium, in Egypt, in a box", () => {
    const r = falls(paris([inf("france", hexesOf("belgium")[0]!), inf("france", hexesOf("egypt")[0]!), unit("france", "air", 5, "us-box")]));
    expect(owned(r.state, "france")).toEqual([]);
    expect(owned(r.state, "vichy-france")).toEqual([]);
    expect(owned(r.state, "free-france")).toEqual([]);
    expect(vichyEvent(r.events).halved).toEqual({ kept: 0, lost: 0 }); // they were never "in European France"
  });
  it("Corsica is European France: a French unit there is halved like the rest", () => {
    const r = falls(paris([inf("france", AJACCIO)]));
    expect(owned(r.state, "vichy-france")).toHaveLength(1);
  });
});

describe("the two colony dice (R5 point 3, V14, V40)", () => {
  const syria = SYRIA[0]!;
  const africa = AFRICA[0]!;
  const withColonies = (even: [boolean, boolean], extra: Unit[] = []) => paris([inf("france", syria), inf("france", africa), ...extra], { rngState: rngFor(...even) });

  it("the dice are Lebanon-Syria first, then Tunisia-Algeria-Morocco, and they are in the event (even = Vichy, odd = Free French)", () => {
    const r = falls(withColonies([true, false]));
    const e = vichyEvent(r.events);
    const a = rollD6(rngFor(true, false));
    const b = rollD6(a.state);
    expect(e.colonies).toEqual([{ colony: "lebanon-syria", die: a.roll, becomes: "vichy" }, { colony: "north-africa", die: b.roll, becomes: "free-french" }]);
    expect(a.roll % 2).toBe(0);
    expect(b.roll % 2).toBe(1);
    expect(FRENCH_COLONIES.map((c) => c.id)).toEqual(["lebanon-syria", "north-africa"]);
  });
  it("all four outcomes: the colony's French units change owner, stay where they are, and the hexes France held there are Vichy or Free French", () => {
    for (const [syriaEven, africaEven] of [[true, true], [true, false], [false, true], [false, false]] as const) {
      const r = falls(withColonies([syriaEven, africaEven]));
      const owner = (hex: string) => Object.values(r.state.units).find((u) => u.at === hex)!.owner;
      expect(owner(syria), `${syriaEven}`).toBe(syriaEven ? "vichy-france" : "free-france");
      expect(owner(africa), `${africaEven}`).toBe(africaEven ? "vichy-france" : "free-france");
      expect(controllerOf(CTX, r.state, syria)).toBe(syriaEven ? "vichy-france" : "free-france");
      expect(controllerOf(CTX, r.state, SYRIA[SYRIA.length - 1]!)).toBe(syriaEven ? "vichy-france" : "free-france");
      for (const h of AFRICA) expect(controllerOf(CTX, r.state, h), h).toBe(africaEven ? "vichy-france" : "free-france");
      expect(vichyEvent(r.events).colonies.map((c) => c.becomes)).toEqual([syriaEven ? "vichy" : "free-french", africaEven ? "vichy" : "free-french"]);
      expect(sideInWar(r.state, "free-france")).toBe("allies");
    }
  });
  it("one die for the three countries of North Africa: they never split", () => {
    const r = falls(withColonies([true, false], [inf("france", hexesOf("morocco")[0]!), inf("france", hexesOf("tunisia")[0]!)]));
    const owners = new Set(Object.values(r.state.units).filter((u) => AFRICA.includes(u.at)).map((u) => u.owner));
    expect([...owners]).toEqual(["free-france"]);
  });
  it("a colony the Axis already holds is not changed (its hexes and units are not France's); the dice are rolled all the same", () => {
    const italian = AFRICA[0]!;
    const s = withColonies([true, true], [inf("italy", AFRICA[1]!)]);
    const r = falls({ ...s, control: { ...s.control, [italian]: "italy", [AFRICA[1]!]: "italy" } });
    expect(controllerOf(CTX, r.state, italian)).toBe("italy");
    expect(controllerOf(CTX, r.state, AFRICA[2]!)).toBe("vichy-france");
    expect(Object.values(r.state.units).find((u) => u.at === AFRICA[1]!)!.owner).toBe("italy");
    expect(r.state.rngState).not.toBe(s.rngState);
  });
  it("the game's random state moves by exactly the two dice and the fall uses no other", () => {
    const s = withColonies([true, true]);
    expect(falls(s).state.rngState).toBe(rollD6(rollD6(s.rngState).state).state);
  });
  it("the Free French pool is empty (nothing can be built for them yet), and their hexes count for the Allies", () => {
    const r = falls(withColonies([false, false]));
    expect(r.state.pools["free-france"]).toEqual({ forcePool: [], allowableBuilds: [] });
    expect(sideInWar(r.state, "free-france")).toBe("allies");
  });
});

describe("British units in Vichy territory are eliminated (R5 point 5, README rule 49.6, V39)", () => {
  const syria = SYRIA[0]!;
  const africa = AFRICA[0]!;
  it("in the Vichy zone and in Corsica, of any kind, with an UNIT_ELIMINATED each; British units elsewhere and other Allied units stay", () => {
    const here = [unit("britain", "infantry", 3, "S19", 4), unit("britain", "fleet", 9, MARSEILLES), unit("britain", "air", 5, VICHY), unit("britain", "infantry", 3, AJACCIO, 4)];
    const safe = [unit("britain", "infantry", 3, "M24", 4), unit("britain", "infantry", 3, "N20", 4), unit("usa", "infantry", 3, "T20", 4)];
    const r = falls(paris([...here, ...safe]));
    for (const u of here) expect(r.state.units[u.id], u.id).toBeUndefined();
    for (const u of safe) expect(r.state.units[u.id], u.id).toBeDefined();
    const gone = ofType(r.events, "UNIT_ELIMINATED").map((e) => (e as Extract<GameEvent, { type: "UNIT_ELIMINATED" }>).unitId).sort();
    expect(gone).toEqual(here.map((u) => u.id).sort());
    expect(vichyEvent(r.events).britishEliminated).toBe(4);
  });
  it("in a colony that becomes Vichy, not in one that becomes Free French", () => {
    const brit = [unit("britain", "infantry", 3, syria, 4), unit("britain", "infantry", 3, africa, 4)];
    const vichySyria = falls(paris([...brit], { rngState: rngFor(true, false) }));
    expect(vichySyria.state.units[brit[0]!.id]).toBeUndefined();
    expect(vichySyria.state.units[brit[1]!.id]).toBeDefined();
    const vichyAfrica = falls(paris([...brit], { rngState: rngFor(false, true) }));
    expect(vichyAfrica.state.units[brit[0]!.id]).toBeDefined();
    expect(vichyAfrica.state.units[brit[1]!.id]).toBeUndefined();
  });
  it("none to eliminate: the count is 0 and no UNIT_ELIMINATED is written", () => {
    const r = falls(paris([]));
    expect(vichyEvent(r.events).britishEliminated).toBe(0);
    expect(ofType(r.events, "UNIT_ELIMINATED")).toEqual([]);
  });
});

describe("the events and the log", () => {
  it("VICHY_CREATED comes after the fall's own events, then the control passed to Vichy and to the Free French, then the British lost", () => {
    const r = falls(paris([inf("france", "M24"), inf("france", SYRIA[0]!), unit("britain", "infantry", 3, "S19", 4)], { rngState: rngFor(false, true) }));
    const t = types(r.events);
    expect(t).toEqual(["COUNTRY_CONQUERED", "CONTROL_PASSED", "VICHY_CREATED", "CONTROL_PASSED", "CONTROL_PASSED", "UNIT_ELIMINATED"]);
    const to = r.events.filter((e) => e.type === "CONTROL_PASSED").map((e) => (e as Extract<GameEvent, { type: "CONTROL_PASSED" }>).to);
    expect(to).toEqual(["germany", "vichy-france", "free-france"]);
  });
  it("the plain fall is unchanged for the others: no VICHY_CREATED when Germany falls", () => {
    const s = board([unit("britain", "infantry", 3, "L31", 4)], SCENARIO_1939, { year: 1940, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, control: { L31: "britain" } });
    expect(types(fall(CTX, s, "germany", "britain").events)).not.toContain("VICHY_CREATED");
  });
  it("the steps are pure: the same state gives the same fall twice, and the input state is not changed", () => {
    const s = paris([inf("france", "M24"), inf("france", SYRIA[0]!)]);
    const frozen = JSON.stringify(s);
    const a = falls(s);
    expect(JSON.stringify(s)).toBe(frozen);
    expect(falls(s)).toEqual(a);
    expect(franceSteps()).toHaveProperty("before");
  });
});

describe("whole games of the computer", () => {
  it("1939 seed 3: Paris falls in Spring 1940, France becomes Vichy, the colonies are decided by the dice, and the computer plays to the end without an anomaly; the same game twice is the same", () => {
    const r = runGame({ scenario: "1939", seed: 3, turns: "end", verify: true });
    expect(r.anomalies).toEqual([]);
    expect(r.ended).toBe("game-over");
    expect(r.final.conquests!.find((c) => c.country === "france")).toMatchObject({ by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "spring" }, startingBrps: 85 });
    expect(r.final.nations.france).toMatchObject({ status: "vichy", brpTotal: 0 });
    expect(r.final.minorAllies).toContainEqual({ owner: "vichy-france", of: "germany", active: false });
    expect(owned(r.final, "france")).toEqual([]);
    expect(r.final.pools.france).toBeUndefined();
    expect(runGame({ scenario: "1939", seed: 3, turns: "end", verify: false }).final).toEqual(r.final);
  });
  it("the Campaign, seed 3: France falls, and Germany later (the Campaign counts both)", () => {
    const r = runGame({ scenario: "campaign", seed: 3, turns: "end", verify: false });
    expect(r.anomalies).toEqual([]);
    expect(r.final.conquests!.map((c) => c.country)).toEqual(expect.arrayContaining(["poland", "france"]));
  });
  it("a position built on purpose: Paris German at the start, both colony outcomes, four Game Turns, no anomaly, nothing of France left but Vichy and Free French counters", () => {
    for (const [a, b] of [[true, true], [false, false]] as const) {
      const prepare = (s: GameState): GameState => ({ ...s, rngState: rngFor(a, b), units: { ...s.units, gParis: counter("gParis", "germany", "infantry", 3, PARIS, 3) }, control: { ...s.control, [PARIS]: "germany" } });
      const r = runGame({ scenario: "1939", seed: 2, turns: 4, verify: true }, { prepare });
      expect(r.anomalies, `${a}${b}`).toEqual([]);
      expect(r.final.nations.france.status).toBe("vichy");
      expect(owned(r.final, "france")).toEqual([]);
      expect(r.final.conquests!.map((c) => c.country)).toContain("france");
    }
  });
  it("a saved list of actions replays to the same state, France's fall included", () => {
    const s = paris([inf("france", "M24")]);
    const action = { type: "END_STEP", side: "allies", step: "7p" } as const;
    const once = applyAction(CTX, s, action);
    expect(once.ok).toBe(true);
    expect(replay(CTX, s, [action]).state).toEqual(once.ok ? once.state : null);
    expect(JSON.parse(JSON.stringify(once.ok ? once.state : null))).toEqual(once.ok ? once.state : null);
  });
});
