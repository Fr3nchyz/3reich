import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import type { GameEvent } from "../src/engine/action-types";
import { CONQUERED_BY_CAPITAL_MINORS, countryLand, fallCountry, minorCapital, minorsFalling, settleMinorConquests } from "../src/engine/conquest-minor";
import { fall } from "../src/engine/conquest";
import { conquestOf, isConquered } from "../src/engine/conquest-record";
import { controllerOf } from "../src/engine/control";
import { combatantName } from "../src/engine/nations";
import { advance } from "../src/engine/turn";
import { declarationTargets, scheduledDeclarations } from "../src/engine/war";
import type { ForceOwner, GameState, Side, Unit } from "../src/engine/types";
import { conquestLine } from "../src/ui/conquestText";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 14 ticket 14-6 (R9, C8; Ref 14.0, 16.0, 17.1, 29.0; PC README 24.23): every country that is not a Major Power falls the same way, Poland first.

const WARSAW = "M35";
const BRUSSELS = "M25";
const STEP_7P = { part: "player-turn", turn: 1, step: "7p" } as const;
const CTX42 = ctxFor(SCENARIO_1942);

/** A game in play at the end of the Combat Phase (step 7p) of `side`, Fall 1939 unless told otherwise. */
function at7p(side: Side, units: Unit[], tweak: Partial<GameState> = {}, scenario = SCENARIO_1939): GameState {
  return board(units, scenario, { year: 1939, season: "fall", firstSide: side, activeSide: side, position: STEP_7P, ...tweak });
}
const types = (events: GameEvent[]) => events.map((e) => e.type);
const leave7p = (state: GameState, ctx = CTX) => advance(ctx, state);
const hexesOf = (events: GameEvent[], to: ForceOwner | null): string[] => {
  const e = events.find((x) => x.type === "CONTROL_PASSED" && x.to === to);
  return e && e.type === "CONTROL_PASSED" ? e.hexes : [];
};
const german = (id: string, at: string) => counter(id, "germany", "infantry", 3, at, 3);
const polish = (id: string, at: string) => counter(id, "poland", "infantry", 2, at, 3);
const polishHexes = Object.values(MAP.hexes).filter((h) => h.land && h.country === "poland").map((h) => h.id);

describe("capitals of the minor countries (map facts)", () => {
  it("the capital hex of each minor country with one on the map; Luxembourg's one hex is its capital (V36); Persia and Arabia have none", () => {
    expect(minorCapital(CTX, "poland")).toBe(WARSAW);
    expect(minorCapital(CTX, "belgium")).toBe(BRUSSELS);
    expect(minorCapital(CTX, "luxembourg")).toBe("O25");
    expect(minorCapital(CTX, "persia")).toBeNull();
    expect(minorCapital(CTX, "arabia")).toBeNull();
    for (const c of CONQUERED_BY_CAPITAL_MINORS) expect(minorCapital(CTX, c), c).not.toBeNull();
    expect(CONQUERED_BY_CAPITAL_MINORS).toHaveLength(17);
  });
  it("a colony is not conquered by its capital (spec 15: all its cities): Egypt's Cairo is not in the list", () => {
    expect(CONQUERED_BY_CAPITAL_MINORS).not.toContain("egypt" as never);
    expect(CONQUERED_BY_CAPITAL_MINORS).not.toContain("albania" as never);
  });
});

describe("when a minor country falls (R9: the end of the attacker's Combat Phase, no turn to retake it)", () => {
  const warsawTaken = (side: Side) => at7p(side, [german("g1", WARSAW), polish("p1", "M34")], { control: { [WARSAW]: "germany" } });

  it("Warsaw held by a German unit: Poland falls when the Axis Combat Phase ends (leaving 7p), the step moves on to 8a", () => {
    const r = leave7p(warsawTaken("axis"));
    expect(isConquered(r.state, "poland")).toBe(true);
    expect(r.state.position).toEqual({ part: "player-turn", turn: 1, step: "8a" });
    expect(types(r.events)).toEqual(["COUNTRY_CONQUERED", "UNITS_REMOVED_BY_CONQUEST", "CONTROL_PASSED"]);
  });
  it("not at the end of the other side's Combat Phase, and not before 7p", () => {
    expect(isConquered(leave7p(warsawTaken("allies")).state, "poland")).toBe(false);
    expect(isConquered(advance(CTX, { ...warsawTaken("axis"), position: { part: "player-turn", turn: 1, step: "7o" } }).state, "poland")).toBe(false);
  });
  it("not while Poland holds Warsaw (a German unit next door is not in the capital)", () => {
    const s = at7p("axis", [german("g1", "M36"), polish("p1", WARSAW)]);
    expect(minorsFalling(CTX, s, "axis")).toEqual([]);
    expect(isConquered(leave7p(s).state, "poland")).toBe(false);
  });
  it("it falls through the sequence, whatever the turn held: END_STEP at 7p does it too", () => {
    const s = warsawTaken("axis");
    const viaEnd = leave7p(s);
    expect(viaEnd.state.conquests).toHaveLength(1);
  });
  it("Poland's units and pool are gone, other nations' units stay; every Polish hex is German; Polish land held elsewhere becomes nobody's", () => {
    const s = at7p("axis", [german("g1", WARSAW), polish("p1", "M34"), polish("p2", "H47"), counter("b1", "britain", "infantry", 3, "L32", 3)], { control: { [WARSAW]: "germany", H47: "poland" } }); // Moscow, held by a Polish unit: land Poland holds outside Poland
    expect(s.pools.poland).toBeDefined();
    const r = leave7p(s);
    expect(Object.keys(r.state.units).sort()).toEqual(["b1", "g1"]);
    expect(r.state.pools.poland).toBeUndefined();
    for (const h of polishHexes) expect(controllerOf(CTX, r.state, h), h).toBe("germany");
    expect(controllerOf(CTX, r.state, "H47")).toBeNull();
    expect(r.state.control.H47).toBeNull();
    expect(hexesOf(r.events, null)).toEqual(["H47"]);
  });
  it("the Conquest record: the country, the conqueror (the owner of the unit in the capital), the side it fought on, 'capital', the Game Turn, no BRPs", () => {
    const r = leave7p(warsawTaken("axis"));
    expect(r.state.conquests).toEqual([{ country: "poland", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } }]);
    expect(conquestOf(r.state, "poland")?.by).toBe("germany");
  });
  it("events: COUNTRY_CONQUERED counts the units and the hexes that changed hands (Warsaw already was German), one UNITS_REMOVED_BY_CONQUEST, no UNIT_ELIMINATED", () => {
    const r = leave7p(warsawTaken("axis"));
    expect(r.events[0]).toMatchObject({ type: "COUNTRY_CONQUERED", country: "poland", by: "germany", how: "capital", unitsRemoved: 1, hexesPassed: polishHexes.length - 1 });
    expect(r.events[1]).toMatchObject({ units: [{ id: "p1", owner: "poland" }] });
    expect(types(r.events)).not.toContain("UNIT_ELIMINATED");
  });
  it("air and fleet counters of Poland alone in Warsaw go with the country (the first symptom of the Warsaw bug, docs/FEEDBACK.md)", () => {
    const s = at7p("axis", [german("g1", WARSAW), counter("pa", "poland", "air", 2, WARSAW, 4)], { control: { [WARSAW]: "germany" } });
    expect(Object.keys(leave7p(s).state.units)).toEqual(["g1"]);
  });
  it("the Wars list keeps its history; no BRPs change; the nations' records are untouched; the game goes on", () => {
    const s = warsawTaken("axis");
    const r = leave7p(s);
    expect(r.state.wars).toEqual(s.wars);
    expect(r.state.nations).toEqual(s.nations);
    expect(r.state.phase).toBe("player-turn");
  });
  it("a hex under a hostile ground unit stays as it is (V12 simplified: the hexes they stand on); one held by nobody is recorded as nobody's, not as neutral land", () => {
    const s = at7p("axis", [german("g1", WARSAW), counter("b1", "britain", "infantry", 3, "M34", 3), counter("b2", "britain", "infantry", 3, "M36", 3)], { control: { [WARSAW]: "germany", M34: "britain" } });
    const r = leave7p(s);
    expect(controllerOf(CTX, r.state, "M34")).toBe("britain"); // held by the British unit that stands there
    expect(controllerOf(CTX, r.state, "M36")).toBe("poland"); // Poland held it; a British unit stands there: it stays as it is
    expect(hexesOf(r.events, "germany")).not.toContain("M34");
    expect(hexesOf(r.events, "germany")).not.toContain("M36");
  });
  it("Poland does not exist in the 1942 scenario: the Germans hold Warsaw from the start and nothing falls", () => {
    const s = board([german("g1", WARSAW)], SCENARIO_1942, { year: 1942, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P });
    expect(controllerOf(CTX42, s, WARSAW)).toBe("germany");
    expect(minorsFalling(CTX42, s, "axis")).toEqual([]);
    expect(leave7p(s, CTX42).state.conquests).toBeUndefined();
  });
  it("nor when the Soviets take Warsaw in 1942: Poland fights for the Allies, who are not its enemies", () => {
    const s = board([counter("s1", "ussr", "infantry", 3, WARSAW, 3)], SCENARIO_1942, { year: 1942, season: "spring", firstSide: "allies", activeSide: "allies", position: STEP_7P, control: { [WARSAW]: "ussr" } });
    expect(minorsFalling(CTX42, s, "allies")).toEqual([]);
  });
  it("a conquered country does not fall twice", () => {
    const r = leave7p(warsawTaken("axis"));
    expect(minorsFalling(CTX, r.state, "axis")).toEqual([]);
    expect(fallCountry(CTX, r.state, { country: "poland", conqueror: "germany" })).toEqual({ state: r.state, events: [] });
  });
  it("a minor's conquest never decides the game: in the Campaign Poland's fall leaves the game on", () => {
    const s = at7p("axis", [german("g1", WARSAW)], { control: { [WARSAW]: "germany" } }, SCENARIO_CAMPAIGN);
    const r = leave7p(s, ctxFor(SCENARIO_CAMPAIGN));
    expect(isConquered(r.state, "poland")).toBe(true);
    expect(r.state.phase).toBe("player-turn");
    expect(r.state.result).toBeUndefined();
  });
  it("a Major Power of the same Combat Phase falls first; the land it held elsewhere becomes nobody's, so Warsaw is nobody's and Poland stands (V11)", () => {
    const s = at7p("axis", [german("g1", WARSAW), counter("b1", "britain", "infantry", 3, "L31", 3)], { control: { [WARSAW]: "germany", L31: "britain" }, nations: { ...SCENARIO_1939.nations, germany: { ...SCENARIO_1939.nations.germany, status: "axis" } } });
    const r = leave7p(s);
    expect(r.state.conquests?.map((c) => c.country)).toEqual(["germany"]);
    expect(settleMinorConquests(CTX, { ...r.state, phase: "game-over" }).events).toEqual([]);
  });
});

describe("a minor country that is not a force owner (Belgium) and the war it needs", () => {
  const atWarWith = (state: GameState): GameState => ({ ...state, wars: [...state.wars, ["germany", "belgium"]] });
  const brussels = (extra: Unit[] = [], tweak: Partial<GameState> = {}) => atWarWith(at7p("axis", [german("g1", BRUSSELS), ...extra], { control: { [BRUSSELS]: "germany" }, ...tweak }));

  it("at war with the holder of Brussels: Belgium falls, all four Belgian hexes are German", () => {
    const r = leave7p(brussels());
    expect(r.state.conquests).toEqual([{ country: "belgium", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } }]);
    for (const h of ["L25", "M25", "M26", "N25"]) expect(controllerOf(CTX, r.state, h), h).toBe("germany");
    expect(hexesOf(r.events, "germany")).toEqual(["L25", "M26", "N25"]);
  });
  it("not at war: a unit in Brussels with no declaration conquers nothing", () => {
    const s = at7p("axis", [german("g1", BRUSSELS)], { control: { [BRUSSELS]: "germany" } });
    expect(minorsFalling(CTX, s, "axis")).toEqual([]);
  });
  it("hexes: a Belgian hex held by an enemy with no unit on it passes; one held by the conqueror's side stays; one with a hostile unit stays; the unit's owner keeps it", () => {
    const s = brussels([counter("b1", "britain", "infantry", 3, "M26", 3), counter("i1", "italy", "infantry", 3, "N25", 3)], { control: { [BRUSSELS]: "germany", L25: "britain", M26: "britain", N25: "italy" }, nations: { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" } } });
    const r = leave7p(s);
    expect(controllerOf(CTX, r.state, "L25")).toBe("germany"); // British-held, nobody there: passes
    expect(controllerOf(CTX, r.state, "M26")).toBe("britain"); // a British unit stands there: kept
    expect(controllerOf(CTX, r.state, "N25")).toBe("italy"); // already held by the conqueror's side: unchanged
  });
  it("a kept hex nobody held becomes nobody's, and nobody's land is not neutral land (it is open to everyone)", () => {
    const r = leave7p(brussels([counter("b1", "britain", "infantry", 3, "L25", 3)]));
    expect(r.state.control.L25).toBeNull();
  });
  it("an enemy counter alone (a fleet or air unit with no ground unit) in a hex that passed is dealt with as in any capture", () => {
    const r = leave7p(brussels([counter("ba", "britain", "air", 2, "N25", 4)]));
    expect(r.state.units.ba).toBeUndefined();
    expect(types(r.events)).toContain("UNITS_SWEPT");
  });
  it("it falls to the owner of the unit in the capital: Italy takes Brussels at war with Belgium, Italy is the conqueror, the record says so", () => {
    const s = { ...at7p("axis", [counter("i1", "italy", "infantry", 3, BRUSSELS, 3)], { control: { [BRUSSELS]: "italy" }, nations: { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" } } }), wars: [["italy", "belgium"]] as GameState["wars"] };
    expect(leave7p(s).state.conquests?.[0]).toMatchObject({ country: "belgium", by: "italy", side: "allies" });
  });
  it("a Minor-Ally's unit in an enemy capital counts for its Major Power's war: a Hungarian unit in Belgrade, Germany at war with Yugoslavia", () => {
    const s = board([counter("h1", "hungary", "infantry", 2, "V29", 3)], SCENARIO_1942, { year: 1942, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, control: { V29: "hungary" }, wars: [["germany", "yugoslavia"], ...SCENARIO_1942.warsAtStart] });
    expect(minorsFalling(CTX42, s, "axis")).toEqual([{ country: "yugoslavia", conqueror: "hungary" }]);
  });
  it("a capital held since before the scenario began (Oslo, German from the start of 1942) is not conquered by standing there; one taken during play is", () => {
    const s = board([german("g1", "C35")], SCENARIO_1942, { year: 1942, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, wars: [["germany", "norway"], ...SCENARIO_1942.warsAtStart] });
    expect(controllerOf(CTX42, s, "C35")).toBe("germany");
    expect(minorsFalling(CTX42, s, "axis")).toEqual([]);
    const taken = board([german("g1", "H22")], SCENARIO_1942, { year: 1942, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, wars: [["germany", "ireland"], ...SCENARIO_1942.warsAtStart], control: { H22: "germany" } });
    expect(minorsFalling(CTX42, taken, "axis")).toEqual([{ country: "ireland", conqueror: "germany" }]); // Dublin, taken during play
  });
});

describe("the Axis Minor-Allies (Finland in 1942)", () => {
  it("in 1939, before spec 15 gives the sleeping allies a record, Finland is a minor like any other: Britain at war with it and holding Helsinki conquers it, for the Axis side", () => {
    const s = { ...at7p("allies", [counter("b1", "britain", "infantry", 3, "D41", 3)], { control: { D41: "britain" } }), wars: [["britain", "finland"]] as GameState["wars"] };
    expect(leave7p(s).state.conquests).toEqual([{ country: "finland", by: "britain", side: "axis", how: "capital", at: { year: 1939, season: "fall" } }]);
  });
  const HELSINKI = "D41";
  const taken = (tweak: Partial<GameState> = {}) =>
    board([counter("s1", "ussr", "infantry", 3, HELSINKI, 3), counter("f1", "finland", "infantry", 2, "D42", 3)], SCENARIO_1942, { year: 1942, season: "spring", firstSide: "allies", activeSide: "allies", position: STEP_7P, control: { [HELSINKI]: "ussr" }, ...tweak });

  it("Helsinki taken by the Soviets: Finland falls at the end of the Allied Combat Phase, its unit and pool go, its Minor-Ally record is inactive, the land passes", () => {
    const s = taken();
    expect(s.pools.finland).toBeDefined();
    const r = leave7p(s, CTX42);
    expect(isConquered(r.state, "finland")).toBe(true);
    expect(r.state.units.f1).toBeUndefined();
    expect(r.state.pools.finland).toBeUndefined();
    expect(r.state.minorAllies.find((m) => m.owner === "finland")?.active).toBe(false);
    expect(r.state.conquests![0]).toMatchObject({ country: "finland", by: "ussr", side: "axis", how: "capital" });
    expect(controllerOf(CTX42, r.state, "D42")).toBe("ussr");
  });
  it("an inactive Minor-Ally falls the same way and can then never be activated: the record is the flag (spec 15 reads isConquered)", () => {
    const s = taken({ minorAllies: SCENARIO_1942.minorAllies.map((m) => (m.owner === "finland" ? { ...m, active: false } : m)) });
    const r = leave7p(s, CTX42);
    expect(isConquered(r.state, "finland")).toBe(true);
    expect(r.state.minorAllies.find((m) => m.owner === "finland")?.active).toBe(false);
  });
  it("not at the end of the Axis Combat Phase", () => {
    expect(isConquered(leave7p({ ...taken(), activeSide: "axis" }, CTX42).state, "finland")).toBe(false);
  });
});

describe("the entry point for colonies and Eastern Europe (the contract for spec 15)", () => {
  const egypt = Object.values(MAP.hexes).filter((h) => h.land && h.country === "egypt").map((h) => h.id);
  const axisItaly = { ...SCENARIO_1939.nations, italy: { ...SCENARIO_1939.nations.italy, status: "axis" as const } };
  const base = () => board([counter("i1", "italy", "infantry", 3, "LL25", 3), counter("b1", "britain", "infantry", 3, "MM29", 3), counter("be", "britain", "air", 2, "MM30", 4)], SCENARIO_1939, { year: 1940, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, nations: axisItaly });

  it("a colony falls by 'all-cities': every hex of its map country passes to the conqueror, except the hex under a hostile ground unit; the record names the colony", () => {
    expect(countryLand(CTX, "egypt")).toEqual(new Set(egypt));
    const r = fallCountry(CTX, base(), { country: "egypt", conqueror: "italy", how: "all-cities" });
    expect(r.state.conquests).toEqual([{ country: "egypt", by: "italy", side: "allies", how: "all-cities", at: { year: 1940, season: "spring" } }]);
    expect(controllerOf(CTX, r.state, "NN32")).toBe("italy");
    expect(controllerOf(CTX, r.state, "MM29")).toBe("britain"); // the British unit stands there
    expect(r.state.units.be).toBeUndefined(); // an air unit alone in a hex that passed
    expect(types(r.events)).toEqual(["COUNTRY_CONQUERED", "CONTROL_PASSED", "UNITS_SWEPT", "UNIT_ELIMINATED", "UNIT_RETURNED_TO_POOL"]); // spec 17 R1: the swept unit goes back to its pool
    expect(r.events[0]).toMatchObject({ unitsRemoved: 0, hexesPassed: egypt.length - 1 });
  });
  it("Eastern Europe is a group of hexes, not a map country: pass them as `hexes`, or let the scenario's zone of that name say", () => {
    const hexes = ["LL25", "LL26", "MM29"];
    const r = fallCountry(CTX, base(), { country: "eastern-europe", conqueror: "germany", how: "all-cities", hexes });
    expect(hexesOf(r.events, "germany")).toEqual(["LL25", "LL26"]); // MM29 is kept: a hostile unit stands there
    expect(r.state.conquests![0]).toMatchObject({ country: "eastern-europe", by: "germany" });
    expect(countryLand(CTX42, "eastern-europe").size).toBeGreaterThan(30);
    expect(countryLand(CTX, "eastern-europe").size).toBe(0);
  });
  it("it is idempotent, changes no BRPs and never touches a Major Power's nation record", () => {
    const first = fallCountry(CTX, base(), { country: "egypt", conqueror: "italy", how: "all-cities" });
    expect(fallCountry(CTX, first.state, { country: "egypt", conqueror: "italy" })).toEqual({ state: first.state, events: [] });
    expect(first.state.nations).toEqual(base().nations);
  });
  it("a conquered minor is not a target for a declaration of war", () => {
    const s = { ...at7p("axis", []), wars: [] as GameState["wars"], activeSide: "axis" as const };
    expect(declarationTargets(CTX, s, "germany")).toContain("belgium");
    const done = fallCountry(CTX, s, { country: "belgium", conqueror: "germany" });
    expect(declarationTargets(CTX, done.state, "germany")).not.toContain("belgium");
  });
  it("the names for the log: Eastern Europe, Lebanon-Syria", () => {
    expect(combatantName("eastern-europe")).toBe("Eastern Europe");
    expect(combatantName("lebanon-syria")).toBe("Lebanon-Syria");
    expect(combatantName("norway")).toBe("Norway");
    const line = conquestLine(CTX, { type: "COUNTRY_CONQUERED", country: "eastern-europe", by: "germany", how: "all-cities", unitsRemoved: 0, hexesPassed: 1 });
    expect(line).toBe("Eastern Europe has been conquered by Germany: 0 units leave the game and 1 hex changes hands.");
  });
});

describe("the extension points of a fall (kept for ticket 14-7): unused, they change nothing; used, they run before and after the stages", () => {
  const berlin = () => at7p("axis", [counter("b1", "britain", "infantry", 3, "L31", 3), counter("g1", "germany", "infantry", 3, "L33", 3), counter("g2", "germany", "infantry", 3, "L34", 3)], { control: { L31: "britain" } });

  it("without steps the result is exactly the plain fall", () => {
    expect(fall(CTX, berlin(), "germany", "britain", "capital", {})).toEqual(fall(CTX, berlin(), "germany", "britain"));
  });
  it("`before` runs first and its work survives (a unit it re-owns is not removed); `after` sees the fallen state and its events come last", () => {
    const r = fall(CTX, berlin(), "germany", "britain", "capital", {
      before: (_c, s) => ({ state: { ...s, units: { ...s.units, g2: { ...s.units.g2!, owner: "vichy-france" } } }, events: [{ type: "TEST_BEFORE" } as unknown as GameEvent] }),
      after: (_c, s) => ({ state: s, events: [{ type: "TEST_AFTER", status: s.nations.germany.status } as unknown as GameEvent] }),
    });
    expect(r.state.units.g2?.owner).toBe("vichy-france");
    expect(r.state.units.g1).toBeUndefined();
    expect(r.events[0]).toEqual({ type: "TEST_BEFORE" });
    expect(r.events.at(-1)).toEqual({ type: "TEST_AFTER", status: "conquered" });
  });
});

describe("the scheduled U.S. declaration against a conquered Germany (the loose end of the 14-5 review; R4: a conquered Power is not a target)", () => {
  const spring42 = (tweak: Partial<GameState> = {}): GameState => board([], SCENARIO_1939, { year: 1942, season: "spring", firstSide: "allies", activeSide: "allies", ...tweak });
  const germany = (status: "axis" | "conquered") => ({ ...SCENARIO_1939.nations, germany: { ...SCENARIO_1939.nations.germany, status } });

  it("Germany standing: the U.S. pays 35 BRPs, the war is recorded and the U.S. joins the Allies (unchanged)", () => {
    const s = spring42({ nations: germany("axis") });
    const r = scheduledDeclarations(CTX, s);
    expect(r.state.nations.usa.brpTotal).toBe(s.nations.usa.brpTotal - 35);
    expect(r.state.wars).toContainEqual(["usa", "germany"]);
    expect(types(r.events)).toContain("WAR_DECLARED");
  });
  it("Germany conquered: nothing is charged, no war is recorded and no declaration is announced; the U.S. still joins its side (V35)", () => {
    const s = spring42({ nations: germany("conquered") });
    const r = scheduledDeclarations(CTX, s);
    expect(r.state.nations.usa.brpTotal).toBe(s.nations.usa.brpTotal);
    expect(r.state.wars).not.toContainEqual(["usa", "germany"]);
    expect(r.events).toEqual([]);
    expect(r.state.nations.usa.status).toBe("allied");
  });
});
