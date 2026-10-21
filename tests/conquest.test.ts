import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions, replay } from "../src/engine/actions";
import { CONQUERED_BY_CAPITAL, capitalOf, powerOfCapital } from "../src/engine/capital";
import { capitalState, fallingNow, fall, settleConquests } from "../src/engine/conquest";
import { controllerOf, controlMap, enterHexes } from "../src/engine/control";
import type { GameEvent } from "../src/engine/action-types";
import { initiativeTotals } from "../src/engine/game";
import { legalDeclarations } from "../src/engine/war";
import { advance } from "../src/engine/turn";
import type { ForceOwner, GameState, Side, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 14 ticket 14-5 (R4; Ref 2.0, 18.1): a Major Power is conquered when an enemy holds its capital at the end of its own Combat Phase.

const BERLIN = "L31";
const LONDON = "K23";
const ROME = "Y22";
const PARIS = "O22";
const STEP_7P = { part: "player-turn", turn: 1, step: "7p" } as const;

/** A game in play at the end of the Combat Phase (step 7p) of `side`, with these counters, the first Game Turn of 1940. */
function at7p(side: Side, units: Unit[], tweak: Partial<GameState> = {}, scenario = SCENARIO_1939): GameState {
  return board(units, scenario, { year: 1940, season: "spring", firstSide: side, activeSide: side, position: STEP_7P, ...tweak });
}
const types = (events: GameEvent[]) => events.map((e) => e.type);
/** Leaves step 7p the way the game does: `advance` (the settle hook is in it). */
const leave7p = (state: GameState, ctx = CTX) => advance(ctx, state);

describe("capitals (map facts)", () => {
  it("the four Powers with a capital on the map: Berlin, London, Rome, Paris; only Germany, Britain and Italy fall by it as built (France is ticket 14-7)", () => {
    expect(["germany", "britain", "italy", "france"].map((p) => capitalOf(CTX, p as "germany"))).toEqual([BERLIN, LONDON, ROME, PARIS]);
    expect(CONQUERED_BY_CAPITAL).toEqual(["germany", "italy", "britain"]);
  });
  it("the U.S.A. cannot be conquered and the U.S.S.R. is not conquered by Moscow (R8, R7): no capital is listed for them", () => {
    expect(capitalOf(CTX, "usa")).toBeNull();
    expect(capitalOf(CTX, "ussr")).toBeNull();
    expect(powerOfCapital(CTX, "H47")).toBeNull(); // Moscow
    expect(powerOfCapital(CTX, BERLIN)).toBe("germany");
    expect(powerOfCapital(CTX, "L32")).toBeNull();
  });
});

describe("the capital is lost, and taken back (the banner events)", () => {
  const british = counter("b1", "britain", "infantry", 3, "L32", 3);
  it("an Allied unit entering Berlin: CAPITAL_LOST names the Power, the hex and the unit's owner", () => {
    const s = at7p("allies", [british]);
    const r = enterHexes(CTX, s, british, [BERLIN]);
    expect(r.events.map((e) => e.type)).toEqual(["HEX_CONTROL_CHANGED", "CAPITAL_LOST"]);
    expect(r.events[1]).toEqual({ type: "CAPITAL_LOST", power: "germany", capital: BERLIN, by: "britain" });
    expect(capitalState(CTX, r.state, "germany")).toBe("capital-lost");
  });
  it("taking it back: CAPITAL_RETAKEN, and the Power is free again", () => {
    const s = at7p("axis", [counter("g1", "germany", "infantry", 3, "L32", 3)], { control: { [BERLIN]: "britain" } });
    const r = enterHexes(CTX, s, s.units.g1!, [BERLIN]);
    expect(r.events.map((e) => e.type)).toEqual(["HEX_CONTROL_CHANGED", "CAPITAL_RETAKEN"]);
    expect(capitalState(CTX, r.state, "germany")).toBe("free");
  });
  it("no banner for a hex that is not a capital, nor for a capital that changes hands inside one side", () => {
    const s = at7p("allies", [british]);
    expect(types(enterHexes(CTX, s, british, ["L33"]).events)).not.toContain("CAPITAL_LOST");
    // France's unit walks into Berlin held by Britain: both Allies, so nothing changes hands and nothing is said
    const held = at7p("allies", [counter("f1", "france", "infantry", 3, "L32", 3)], { control: { [BERLIN]: "britain" } });
    expect(enterHexes(CTX, held, held.units.f1!, [BERLIN]).events).toEqual([]);
  });
  it("a capital that nobody controls is not held by the enemy: the Power is free (nobody's land belongs to no side)", () => {
    const s = at7p("axis", [], { control: { [BERLIN]: null } });
    expect(capitalState(CTX, s, "germany")).toBe("free");
    expect(fallingNow(CTX, s, "axis")).toEqual([]);
  });
  it("a Power that is not in the war has no capital to lose (neutral Italy)", () => {
    const s = at7p("allies", [], { control: { [ROME]: "britain" } });
    expect(capitalState(CTX, s, "italy")).toBe("free");
    expect(fallingNow(CTX, s, "axis")).toEqual([]);
  });
});

describe("when a Power falls (R4: the end of its own Combat Phase, step 7p)", () => {
  const berlinTaken = (side: Side) => at7p(side, [counter("b1", "britain", "infantry", 3, BERLIN, 3), counter("g1", "germany", "infantry", 3, "L33", 3)], { control: { [BERLIN]: "britain" } });

  it("not at the end of the enemy's Combat Phase: the Allies' 7p leaves Germany standing", () => {
    const r = leave7p(berlinTaken("allies"));
    expect(r.state.nations.germany.status).toBe("axis");
    expect(r.state.conquests).toBeUndefined();
    expect(r.events).toEqual([]);
  });
  it("at the end of its own: leaving 7p of the Axis turn conquers Germany, the step moves on to 8a", () => {
    const r = leave7p(berlinTaken("axis"));
    expect(r.state.nations.germany.status).toBe("conquered");
    expect(r.state.position).toEqual({ part: "player-turn", turn: 1, step: "8a" });
    expect(types(r.events)).toContain("COUNTRY_CONQUERED");
  });
  it("not before 7p: leaving 7o does nothing", () => {
    const r = advance(CTX, { ...berlinTaken("axis"), position: { part: "player-turn", turn: 1, step: "7o" } });
    expect(r.state.nations.germany.status).toBe("axis");
  });
  it("taken back in its own Combat Phase: free, not conquered (the owner has exactly one Combat Phase)", () => {
    const s = berlinTaken("axis");
    const back = { ...s, control: {}, units: { g1: s.units.g1! } }; // the Germans hold Berlin again
    const r = leave7p(back);
    expect(r.state.nations.germany.status).toBe("axis");
    expect(capitalState(CTX, r.state, "germany")).toBe("free");
  });
  it("conquest follows from the sequence, whatever the turn held: through END_STEP at 7p, and over a whole Player Turn from 7h with nothing to attack", () => {
    const s = berlinTaken("axis");
    const viaAction = applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "7p" });
    expect(viaAction.ok && viaAction.state.nations.germany.status).toBe("conquered");
    // from 7h: the step 7h has nothing to wait for (no attackable hex), so settle passes through to 7p by itself
    const from7h = applyAction(CTX, { ...s, units: { b1: s.units.b1! }, position: { part: "player-turn", turn: 1, step: "7g" } }, { type: "END_STEP", side: "axis", step: "7g" });
    expect(from7h.ok && from7h.state.nations.germany.status).toBe("conquered");
  });
  it("France is not conquered by Paris yet (ticket 14-7 owns its fall, with Vichy): Paris taken says nothing and changes nothing", () => {
    const paris = at7p("allies", [counter("g1", "germany", "infantry", 3, PARIS, 3)], { control: { [PARIS]: "germany" } });
    expect(fallingNow(CTX, paris, "allies")).toEqual([]);
    expect(capitalState(CTX, paris, "france")).toBe("free");
    const r = leave7p(paris);
    expect(r.state.nations.france.status).toBe("allied");
    expect(r.events).toEqual([]);
    const walker = counter("g2", "germany", "infantry", 3, "O23", 3);
    expect(enterHexes(CTX, { ...paris, control: {} }, walker, [PARIS]).events.map((e) => e.type)).toEqual(["HEX_CONTROL_CHANGED"]);
    // the mechanism itself is the same function: called directly it conquers France like any Power
    expect(fall(CTX, paris, "france", "germany").state.nations.france.status).toBe("conquered");
  });
  it("Britain and Italy fall by London and Rome", () => {
    const london = at7p("allies", [counter("g1", "germany", "infantry", 3, LONDON, 3)], { control: { [LONDON]: "germany" } });
    expect(leave7p(london).state.nations.britain.status).toBe("conquered");
    const rome = at7p("axis", [counter("b1", "britain", "infantry", 3, ROME, 3)], { control: { [ROME]: "britain" }, nations: { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" } } });
    expect(leave7p(rome).state.nations.italy.status).toBe("conquered");
    expect(fallingNow(CTX, rome, "axis")).toEqual(["italy"]);
  });
  it("the U.S.S.R. and the U.S.A. are never conquered by a capital (a Soviet side with an enemy in Moscow is not listed)", () => {
    const moscow = at7p("allies", [counter("g1", "germany", "infantry", 3, "H47", 3)], { control: { H47: "germany" }, nations: { ...SCENARIO_1939.nations, ussr: { ...SCENARIO_1939.nations.ussr, status: "allied" } } });
    expect(fallingNow(CTX, moscow, "allies")).toEqual([]);
  });
});

describe("what a fall does (C8)", () => {
  const warsaw = "M35";
  const norwegian = "C35"; // Oslo
  function falling(extra: Unit[] = [], tweak: Partial<GameState> = {}) {
    const units = [
      counter("b1", "britain", "infantry", 3, BERLIN, 3),
      counter("g1", "germany", "infantry", 3, "L33", 3),
      counter("g2", "germany", "armor", 4, warsaw, 5),
      counter("g3", "germany", "air", 2, "L34", 4),
      counter("f1", "france", "infantry", 3, "M24", 3),
      ...extra,
    ];
    return at7p("axis", units, { control: { [BERLIN]: "britain", [warsaw]: "germany", [norwegian]: "germany" }, ...tweak });
  }
  const done = () => fall(CTX, falling(), "germany", "britain");

  it("units: all German units are gone, others stay; the pool and the Allowable Builds go too", () => {
    const { state } = done();
    expect(Object.keys(state.units).sort()).toEqual(["b1", "f1"]);
    expect(state.pools.germany).toBeUndefined();
    expect(falling().pools.germany).toBeDefined();
  });
  it("status and BRPs: conquered, total 0, spending limit 0, spent 0; the Base stays", () => {
    const g = done().state.nations.germany;
    expect([g.status, g.brpTotal, g.spendLimit, g.spent, g.brpBase]).toEqual(["conquered", 0, 0, 0, 150]);
  });
  it("the Conquest record: country, conqueror, side, how, the Game Turn, the BRPs it began with", () => {
    expect(done().state.conquests).toEqual([{ country: "germany", by: "britain", side: "axis", how: "capital", at: { year: 1940, season: "spring" }, startingBrps: 150 }]);
  });
  it("home hexes (the map country 'germany') pass to the conqueror: all 64 German hexes are British; the event counts the 63 that changed hands (Berlin already was)", () => {
    const { state, events } = done();
    const home = Object.values(MAP.hexes).filter((h) => h.country === "germany").map((h) => h.id);
    expect(home).toHaveLength(64);
    for (const h of home) expect(controllerOf(CTX, state, h), h).toBe("britain");
    const passed = events.find((e) => e.type === "CONTROL_PASSED" && e.to === "britain");
    expect(passed && "hexes" in passed ? passed.hexes : []).toHaveLength(63);
  });
  it("land held elsewhere (Warsaw, Oslo) becomes nobody's, and a nobody hex does not go back to its start owner", () => {
    const { state, events } = done();
    expect(controllerOf(CTX, state, warsaw)).toBeNull();
    expect(controllerOf(CTX, state, norwegian)).toBeNull();
    expect(state.control[warsaw]).toBeNull();
    expect(controlMap(CTX, state).has(warsaw)).toBe(false);
    const nobody = events.find((e) => e.type === "CONTROL_PASSED" && e.to === null);
    expect(nobody && "hexes" in nobody ? nobody.hexes.sort() : []).toEqual([norwegian, warsaw].sort());
  });
  it("the first ground unit to walk into nobody's land takes it, at war with anyone or not", () => {
    const s = done().state;
    const walker = counter("f9", "france", "infantry", 3, "M34", 3);
    const r = enterHexes(CTX, { ...s, units: { ...s.units, f9: walker } }, walker, [warsaw]);
    expect(r.state.control[warsaw]).toBe("france");
    expect(r.events[0]).toMatchObject({ type: "HEX_CONTROL_CHANGED", hex: warsaw, from: null, to: "france" });
  });
  it("the events: the fall, the units that left (one event), the land that passed (two), no UNIT_ELIMINATED for each", () => {
    const { events } = done();
    expect(types(events)).toEqual(["COUNTRY_CONQUERED", "UNITS_REMOVED_BY_CONQUEST", "CONTROL_PASSED", "CONTROL_PASSED"]);
    expect(events[0]).toMatchObject({ country: "germany", by: "britain", how: "capital", unitsRemoved: 3, hexesPassed: 63 });
    expect(events[1]).toMatchObject({ units: [{ id: "g1" }, { id: "g2" }, { id: "g3" }] });
  });
  it("the Wars list keeps its history", () => {
    expect(done().state.wars).toEqual(falling().wars);
  });
  it("the conqueror is the owner of the unit in the capital: the settle hook takes it from the control record", () => {
    const r = settleConquests(CTX, falling());
    expect(r.state.conquests![0]!.by).toBe("britain");
    const french = settleConquests(CTX, falling([], { control: { [BERLIN]: "france", [warsaw]: "germany" } }));
    expect(french.state.conquests![0]!.by).toBe("france");
    expect(controllerOf(CTX, french.state, "J29")).toBe("france");
  });
  it("hexes under hostile ground units that survive stay as they are (V12 simplified): an Axis Italian unit standing on German land keeps that hex German-held; the hexes around it pass", () => {
    const axisItaly = { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" as const } };
    const s = falling([counter("i1", "italy", "infantry", 3, "J29", 3)], { nations: axisItaly });
    const r = fall(CTX, s, "germany", "britain");
    expect(controllerOf(CTX, r.state, "J29")).toBe("germany");
    expect(controllerOf(CTX, r.state, "J30")).toBe("britain");
    expect(r.state.units.i1).toBeDefined();
    // with Italy neutral its unit is no enemy of the conqueror, and the hex passes
    expect(controllerOf(CTX, fall(CTX, falling([counter("i1", "italy", "infantry", 3, "J29", 3)]), "germany", "britain").state, "J29")).toBe("britain");
  });
  it("Minor-Allies go with their Power: units and pool removed, they become inactive, their land is nobody's (1944: Finland, Rumania, Hungary, Bulgaria)", () => {
    const ctx = ctxFor(SCENARIO_1944);
    const finn = counter("fi1", "finland", "infantry", 2, "D41", 3);
    const s = board([counter("b1", "britain", "infantry", 3, BERLIN, 3), counter("g1", "germany", "infantry", 3, "L33", 3), finn], SCENARIO_1944, { year: 1944, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, control: { [BERLIN]: "britain" } });
    expect(s.minorAllies.some((m) => m.owner === "finland" && m.active)).toBe(true);
    const r = fall(ctx, s, "germany", "britain");
    expect(r.state.units.fi1).toBeUndefined();
    expect(r.state.pools.finland).toBeUndefined();
    expect(r.state.minorAllies.every((m) => !m.active)).toBe(true);
    expect(controllerOf(ctx, r.state, "D41")).toBeNull();
  });
  it("lent counters: ones of the fallen nationality that another owner holds go with it; ones it holds for another Power go back to that Power if it is still in the war, else are removed", () => {
    const lentToItaly = { ...counter("g9", "germany", "fleet", 3, "L22"), nationality: "italy" as ForceOwner };
    const italianInGermany = { ...counter("i9", "italy", "fleet", 3, "L23"), nationality: "germany" as ForceOwner };
    const s = falling([lentToItaly, italianInGermany], { nations: { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" } } });
    const r = fall(CTX, s, "germany", "britain").state;
    expect(r.units.g9).toMatchObject({ owner: "italy" });
    expect(r.units.g9!.nationality).toBeUndefined();
    expect(r.units.i9).toBeUndefined();
    // Italy out of the war: the counter Germany held for it is removed
    const out = fall(CTX, falling([lentToItaly]), "germany", "britain").state;
    expect(out.units.g9).toBeUndefined();
  });
  it("an enemy fleet left alone in a port that passed is displaced or destroyed as in any capture (afterHexTaken)", () => {
    const fleet = counter("i7", "italy", "fleet", 3, "K32"); // a German port on the Baltic? replaced below if not a port
    const port = Object.values(MAP.hexes).find((h) => h.country === "germany" && h.features.some((f) => f === "port" || f === "capital-port"));
    const s = falling([{ ...fleet, at: port!.id }], { nations: { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" } } });
    const r = fall(CTX, s, "germany", "britain");
    expect(types(r.events)).toContain("FLEET_DISPLACED");
    expect(r.state.units.i7?.at).not.toBe(port!.id);
  });
});

describe("a conquered Power gives and takes nothing (grants, declarations, Initiative)", () => {
  const conquered = () => fall(CTX, at7p("axis", [counter("b1", "britain", "infantry", 3, BERLIN, 3)], { control: { [BERLIN]: "britain" } }), "germany", "britain").state;
  it("it cannot declare war, and nobody can declare war on it", () => {
    const s = { ...conquered(), activeSide: "axis" as const, position: { part: "player-turn", turn: 1, step: "1" } as const };
    expect(legalDeclarations(CTX, s).filter((a) => a.type === "DECLARE_WAR" && a.by === "germany")).toEqual([]);
    const allies = { ...conquered(), activeSide: "allies" as const, position: { part: "player-turn", turn: 1, step: "1" } as const, nations: { ...conquered().nations, usa: { ...conquered().nations.usa, status: "allied" as const } } };
    expect(legalDeclarations(CTX, allies).some((a) => a.type === "DECLARE_WAR" && a.on === "germany")).toBe(false);
  });
  it("it gives no grants and receives none (Italy, its ally, cannot grant to it)", () => {
    const s = { ...conquered(), activeSide: "axis" as const, position: { part: "player-turn", turn: 1, step: "9a" } as const };
    const withItaly = { ...s, nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" as const, brpTotal: 100, spendLimit: 50 }, germany: { ...s.nations.germany, brpTotal: 40, spendLimit: 20 } } };
    expect(legalActions(CTX, withItaly).filter((a) => a.type === "GRANT_BRPS")).toEqual([]);
  });
  it("the Initiative: it adds 0 to its side's total (the sum is read from the BRPs, so game.ts needs no change)", () => {
    const s = conquered();
    expect(initiativeTotals(s)).toEqual({ axis: 0 + SCENARIO_1939.nations.italy.brpTotal, allies: SCENARIO_1939.nations.france.brpTotal + SCENARIO_1939.nations.britain.brpTotal });
  });
});

describe("the question 'is the game decided?' after a fall (R3, Q1)", () => {
  const taken = (scenario: typeof SCENARIO_1939, year: number, season: "spring" | "summer" | "fall" | "winter") =>
    board([counter("b1", "britain", "infantry", 3, BERLIN, 3)], scenario, { year, season, firstSide: "axis", activeSide: "axis", position: STEP_7P, control: { [BERLIN]: "britain" } });
  it("1944: Germany falls and the game ends at once, with an early result of the window the Game Turn is in", () => {
    const r = leave7p(taken(SCENARIO_1944, 1945, "spring"), ctxFor(SCENARIO_1944));
    expect(r.state.phase).toBe("game-over");
    expect(r.state.result).toMatchObject({ winner: "allies", level: "tactical", basis: "conquest", early: true, at: { year: 1945, season: "spring" } });
    expect(r.events.at(-1)).toMatchObject({ type: "GAME_OVER", year: 1945, season: "spring" });
    expect(legalActions(ctxFor(SCENARIO_1944), r.state)).toEqual([]);
  });
  it("1944: the date of the result is the Game Turn the conquest completes in (Winter 1944 is Decisive, Summer 1945 Marginal)", () => {
    expect(leave7p(taken(SCENARIO_1944, 1944, "winter"), ctxFor(SCENARIO_1944)).state.result).toMatchObject({ winner: "allies", level: "decisive" });
    expect(leave7p(taken(SCENARIO_1944, 1945, "summer"), ctxFor(SCENARIO_1944)).state.result).toMatchObject({ winner: "allies", level: "marginal" });
  });
  it("1939 and 1942 never end early: Germany conquered, the game goes on to the last turn", () => {
    const r = leave7p(taken(SCENARIO_1939, 1940, "spring"));
    expect(r.state.nations.germany.status).toBe("conquered");
    expect(r.state.phase).toBe("player-turn");
    expect(r.state.result).toBeUndefined();
    expect(types(r.events)).not.toContain("GAME_OVER");
  });
  it("the Campaign: Germany alone does not end it (the Axis is conquered only with Italy too)", () => {
    const r = leave7p(taken(SCENARIO_CAMPAIGN, 1941, "summer"), ctxFor(SCENARIO_CAMPAIGN));
    expect(r.state.nations.germany.status).toBe("conquered");
    expect(r.state.phase).toBe("player-turn");
  });
  it("the Campaign: Germany then Italy ends it, in the Game Turn the second one falls", () => {
    const ctx = ctxFor(SCENARIO_CAMPAIGN);
    const s0 = taken(SCENARIO_CAMPAIGN, 1941, "summer");
    const g = leave7p(s0, ctx).state;
    const italy = { ...g, year: 1942, season: "spring" as const, position: STEP_7P, units: { ...g.units, b2: counter("b2", "britain", "infantry", 3, ROME, 3) }, control: { ...g.control, [ROME]: "britain" as ForceOwner }, nations: { ...g.nations, italy: { ...g.nations.italy, status: "axis" as const } } };
    const r = leave7p(italy, ctx);
    expect(r.state.phase).toBe("game-over");
    expect(r.state.result).toMatchObject({ winner: "allies", level: "decisive", early: true, at: { year: 1942, season: "spring" } });
  });
});

describe("determinism", () => {
  it("the same actions replay to the same state, conquest included (no clock, no random: the engine-purity test also guards the new files)", () => {
    const s = at7p("axis", [counter("b1", "britain", "infantry", 3, BERLIN, 3), counter("g1", "germany", "infantry", 3, "L33", 3)], { control: { [BERLIN]: "britain" } });
    const action = { type: "END_STEP", side: "axis", step: "7p" } as const;
    const once = applyAction(CTX, s, action);
    expect(once.ok).toBe(true);
    expect(replay(CTX, s, [action]).state).toEqual(once.ok ? once.state : null);
    expect(JSON.parse(JSON.stringify(once.ok ? once.state : null))).toEqual(once.ok ? once.state : null); // plain data: a save keeps the null control entries
  });
});

describe("old saved games and the pure queries", () => {
  it("a state without the new field reads as 'nobody has been conquered'; fallingNow is empty in the opening position", () => {
    const s = board([]);
    expect(s.conquests).toBeUndefined();
    expect(fallingNow(CTX, s, "axis")).toEqual([]);
    expect(fallingNow(CTX, s, "allies")).toEqual([]);
    expect((["germany", "britain", "france", "italy", "usa", "ussr"] as const).map((p) => capitalState(CTX, s, p))).toEqual(Array(6).fill("free"));
  });
  it("capitalState says 'conquered' after the fall", () => {
    const s = fall(CTX, at7p("axis", [counter("b1", "britain", "infantry", 3, BERLIN, 3)], { control: { [BERLIN]: "britain" } }), "germany", "britain").state;
    expect(capitalState(CTX, s, "germany")).toBe("conquered");
    expect(fallingNow(CTX, s, "axis")).toEqual([]);
  });
});
