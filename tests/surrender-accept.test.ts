import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions } from "../src/engine/actions";
import { controllerOf } from "../src/engine/control";
import { neutralLandProblem } from "../src/engine/movement";
import { objectiveHexes, objectiveStandings } from "../src/engine/objectives";
import { conquestIncome } from "../src/engine/conquest-income";
import { enterHexes } from "../src/engine/control";
import { sovietCityOpen } from "../src/engine/soviet";
import { creditedObjectives } from "../src/engine/soviet-surrender";
import { evaluateVictory } from "../src/engine/victory";
import { runYearStartSequence } from "../src/engine/yearstart";
import type { GameState } from "../src/engine/types";
import { counter } from "./board";
import { CTX, ctxFor } from "./helpers";
import { air, answer, asked, askedWith, at9k, eventsOf, ger, IN, LENINGRAD, many, MOSCOW, objectiveOutside, objectivesInside, OUT, rus, STALINGRAD } from "./helpers-surrender";

// Spec 14 ticket 14-15, R7c (Ref 18.41): the Axis accept. Russia is conquered by Germany without its land changing hands: units and pool go, the Objectives credited to the Allies
// for good, Germany gets half of Russia's starting BRPs, the 15s of Moscow and Leningrad stop, Russian land is closed to the Axis. TODO(verify) V19, V48, V49.

const SMOLENSK = "J43"; // an Objective in Russia
const KHARKOV = "O43"; // another
const BRITISH = "A47";

/** The offer made and waiting, with a little of everything on the map: Russian units in and out of Russia (47 factors), Axis and British units (72 and more), and Objectives in different hands. */
function waiting(control: GameState["control"] = {}): GameState {
  const units = [...many("r", "ussr", 10, 4, IN.slice(0, 5)), rus("rout", OUT, 5), air("rair", "ussr", IN[0], 2), ...many("g", "germany", 18, 4, IN.slice(5)), ger("gout", OUT), counter("brit", "britain", "infantry", 3, BRITISH, 3)];
  const base = at9k(units);
  return askedWith(units, { control: { ...base.control, [SMOLENSK]: "germany", [KHARKOV]: null, [objectiveOutside()]: "ussr", ...control } });
}

describe("what the Axis accept (R7c)", () => {
  const before = waiting();
  const outside = objectiveOutside();
  it("the offer is open before the answer", () => {
    expect(before.soviet?.offer).toBe("asking");
    expect(before.units["rout"]).toBeDefined();
  });
  const done = answer(before, true);
  const after = done.state;

  it("every Russian unit leaves the game, in Russia and out of it, air included; the Axis and the British stay", () => {
    expect(Object.values(after.units).filter((u) => u.owner === "ussr")).toEqual([]);
    expect(Object.values(after.units).filter((u) => u.owner !== "ussr")).toHaveLength(Object.values(before.units).filter((u) => u.owner !== "ussr").length);
    expect(eventsOf(done.events, "UNITS_REMOVED_BY_CONQUEST")[0]!.units).toHaveLength(Object.values(before.units).filter((u) => u.owner === "ussr").length);
  });
  it("the Force Pool and the Allowable Builds of Russia go too", () => {
    expect(before.pools.ussr).toBeDefined();
    expect(after.pools.ussr).toBeUndefined();
  });
  it("the nation is conquered with 0 BRPs and a spending limit of 0; Germany's BRPs do not change now", () => {
    expect(after.nations.ussr).toMatchObject({ status: "conquered", brpTotal: 0, spendLimit: 0, spent: 0 });
    expect(after.nations.germany.brpTotal).toBe(before.nations.germany.brpTotal);
  });
  it("Germany conquers it 'by surrender', on the Allies' side, with the BRPs it began the scenario with", () => {
    expect(after.conquests).toEqual([{ country: "ussr", by: "germany", side: "allies", how: "surrender", at: { year: 1941, season: "winter" }, startingBrps: SCENARIO_1939.nations.ussr.brpTotal }]);
  });
  it("the events, in order: the surrender, the conquest, the units, then the credited Objectives", () => {
    expect(done.events.map((e) => e.type).filter((t) => t !== "STEPS_PASSED")).toEqual(["RUSSIA_SURRENDERED", "COUNTRY_CONQUERED", "UNITS_REMOVED_BY_CONQUEST", "OBJECTIVES_CREDITED"]);
    expect(eventsOf(done.events, "COUNTRY_CONQUERED")).toEqual([{ type: "COUNTRY_CONQUERED", country: "ussr", by: "germany", how: "surrender", unitsRemoved: 12, hexesPassed: 0 }]);
    expect(eventsOf(done.events, "CONTROL_PASSED")).toEqual([]);
  });
  it("the game goes on to step 10b of the same Player Turn and nothing is asked any more", () => {
    expect(after.position).toEqual({ part: "player-turn", turn: 2, step: "10b" });
    expect(after.phase).toBe("player-turn");
    expect(legalActions(CTX, after).length).toBeGreaterThan(0);
    expect(after.soviet?.offer).toBe("accepted");
  });

  describe("the Objectives (R1, R7c)", () => {
    it("credited: those the U.S.S.R. holds (also outside Russia) and those in Russia the Axis does not hold, nobody's and Allied ones included; not the ones the Axis holds", () => {
      const credited = after.soviet!.credited!;
      expect(credited).toContain(outside);
      expect(credited).toContain(KHARKOV); // nobody's
      expect(credited).toContain(STALINGRAD); // the U.S.S.R.'s own
      expect(credited).not.toContain(SMOLENSK); // the Axis hold it
      expect([...credited].sort()).toEqual(credited);
      expect(credited).toEqual(creditedObjectives(CTX, before));
      expect(eventsOf(done.events, "OBJECTIVES_CREDITED")).toEqual([{ type: "OBJECTIVES_CREDITED", hexes: credited }]);
    });
    it("an Objective outside Russia that the Allies (not the U.S.S.R.) hold, and one the Axis hold in Russia, are not in the list", () => {
      const other = objectiveHexes(CTX).find((h) => CTX.map.hexes[h]!.country !== "ussr" && h !== outside)!;
      const s = waiting({ [other]: "britain" });
      expect(creditedObjectives(CTX, s)).not.toContain(other);
    });
    it("they count for the Allies in the standings, and still do when the Axis later hold the hex", () => {
      const s = objectiveStandings(CTX, after);
      for (const h of after.soviet!.credited!) expect(s.allies).toContain(h);
      const taken = { ...after, control: { ...after.control, [STALINGRAD]: "germany" as const, [KHARKOV]: "germany" as const } };
      expect(objectiveStandings(CTX, taken).allies).toContain(STALINGRAD);
      expect(objectiveStandings(CTX, taken).allies).toContain(KHARKOV);
      expect(objectiveStandings(CTX, taken).axis).not.toContain(KHARKOV);
    });
    it("the standings still add up to 42", () => {
      const s = objectiveStandings(CTX, after);
      expect(s.axis.length + s.allies.length + s.nobody.length).toBe(42);
    });
    it("the Objectives the Axis hold when the surrender is accepted stay the Axis'", () => {
      expect(objectiveStandings(CTX, after).axis).toContain(SMOLENSK);
    });
    it("the result at the end of play counts the credited Objectives for the Allies", () => {
      const plain = { ...after, soviet: { ...after.soviet!, credited: [] } };
      const withCredit = evaluateVictory(CTX, { ...after, phase: "game-over" }, "end-of-play");
      const without = evaluateVictory(CTX, { ...plain, phase: "game-over" }, "end-of-play");
      expect(withCredit.objectives.allies).toBeGreaterThan(without.objectives.allies);
      expect(withCredit.objectives.allies - without.objectives.allies).toBe(after.soviet!.credited!.filter((h) => objectiveStandings(CTX, plain).allies.indexOf(h) < 0).length);
    });
  });

  describe("the land (R7c): it stays Russian and the Axis cannot enter", () => {
    it("no hex changes hands: control is exactly as it was", () => {
      expect(after.control).toEqual(before.control);
      expect(controllerOf(CTX, after, "A49")).toBe("ussr");
      expect(controllerOf(CTX, after, MOSCOW)).toBe("ussr");
    });
    it("Russia leaves the war: the war records of the U.S.S.R. are gone, the others stay", () => {
      expect(before.wars.some((w) => w.includes("ussr"))).toBe(true);
      expect(after.wars.some((w) => w.includes("ussr"))).toBe(false);
      expect(after.wars.length).toBe(before.wars.filter((w) => !w.includes("ussr")).length);
    });
    it("the neutral-land rule now closes Russian land to the Axis (before the surrender it was open, the two being at war)", () => {
      expect(neutralLandProblem(CTX, before, ["germany"], "A49")).toBeNull();
      expect(neutralLandProblem(CTX, after, ["germany"], "A49")).toContain("neutral land");
      expect(neutralLandProblem(CTX, after, ["italy"], MOSCOW)).toContain("neutral land");
    });
    it("a real move of an Axis unit into Russian land is refused", () => {
      const s: GameState = { ...after, activeSide: "axis", firstSide: "axis", position: { part: "player-turn", turn: 1, step: "6f" }, units: { ...after.units, gx: counter("gx", "germany", "infantry", 3, "A50", 3) } };
      const r = applyAction(CTX, s, { type: "MOVE", side: "axis", units: ["gx"], path: ["A49"] });
      expect(r.ok).toBe(false);
    });
  });

  describe("the income (R7c): half of Russia's starting BRPs a year for Germany, from the next Year Start Sequence", () => {
    const start = SCENARIO_1939.nations.ussr.brpTotal;
    it("conquestIncome is half, rounded down, whether or not the Axis hold Moscow (V48)", () => {
      expect(conquestIncome(CTX, after, "germany")).toBe(Math.floor(start / 2));
      expect(controllerOf(CTX, after, MOSCOW)).toBe("ussr");
      expect(conquestIncome(CTX, after, "britain")).toBe(0);
    });
    it("the Year Start Sequence adds it to Germany's total, leaves the U.S.S.R. alone, and says so", () => {
      const spring = { ...after, season: "spring" as const, year: 1942 };
      const y = runYearStartSequence(CTX, spring);
      const gain = y.state.nations.germany.brpTotal - runYearStartSequence(CTX, { ...spring, conquests: [] }).state.nations.germany.brpTotal;
      expect(gain).toBe(Math.floor(start / 2));
      expect(y.state.nations.ussr).toEqual(spring.nations.ussr);
      expect(y.events.find((e) => e.type === "BRPS_CHANGED" && e.nation === "germany")).toMatchObject({ reason: expect.stringContaining("from conquered countries") });
    });
  });

  describe("Moscow and Leningrad (R7a): the 15s stop", () => {
    it("the cities are closed for payment once Russia has surrendered", () => {
      expect(sovietCityOpen(before)).toBe(true);
      expect(sovietCityOpen(after)).toBe(false);
    });
    it("a later capture pays nothing and the Year Start Sequence moves no 15", () => {
      const unit = counter("gm", "germany", "infantry", 3, MOSCOW, 3);
      const r = enterHexes(CTX, { ...after, units: { ...after.units, gm: unit } }, unit, [MOSCOW]);
      expect(eventsOf(r.events, "RUSSIA_BRPS_MOVED")).toEqual([]);
      const held = { ...after, control: { ...after.control, [MOSCOW]: "germany" as const, [LENINGRAD]: "germany" as const }, season: "spring" as const, year: 1942 };
      const y = runYearStartSequence(CTX, held);
      expect(y.events.some((e) => e.type === "BRPS_CHANGED" && e.reason.includes("Moscow"))).toBe(false);
    });
  });
});

describe("the victory computation after a surrender (hazard 4)", () => {
  it("1939: a surrender does not end the game early; the game goes on", () => {
    const s = answer(waiting(), true).state;
    expect(s.phase).toBe("player-turn");
    expect(s.result).toBeUndefined();
  });
  it("the Campaign: with Britain and France conquered, the surrender is the third Allied Power and the game ends at once, Axis Decisive", () => {
    const ctx = ctxFor(SCENARIO_CAMPAIGN);
    const base = asked({ conquests: [{ country: "britain", by: "germany", side: "allies", how: "capital", at: { year: 1941, season: "fall" } }, { country: "france", by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "spring" } }] }, SCENARIO_CAMPAIGN);
    const done = answer(base, true, ctx);
    expect(done.state.phase).toBe("game-over");
    expect(done.state.result).toMatchObject({ winner: "axis", level: "decisive", basis: "powers-conquered", early: true });
    expect(eventsOf(done.events, "GAME_OVER")).toHaveLength(1);
    expect(done.events.at(-1)!.type).toBe("GAME_OVER");
    expect(done.state.position).toEqual({ part: "player-turn", turn: 2, step: "10a" }); // the game stops where it was decided
    expect(legalActions(ctx, done.state)).toEqual([]);
    expect(applyAction(ctx, done.state, { type: "SURRENDER_ANSWER", side: "axis", accept: true }).ok).toBe(false);
  });
  it("the Campaign with only one other Allied Power conquered: not decided", () => {
    const ctx = ctxFor(SCENARIO_CAMPAIGN);
    const base = asked({ conquests: [{ country: "france", by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "spring" } }] }, SCENARIO_CAMPAIGN);
    expect(answer(base, true, ctx).state.phase).toBe("player-turn");
  });
});
