import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction } from "../src/engine/actions";
import { turnKey } from "../src/engine/combat-record";
import { enterHexes } from "../src/engine/control";
import { SOVIET_CITY_BRPS, sovietCityAt, sovietCityHexes, sovietCityOpen, sovietCityTaken } from "../src/engine/soviet";
import { citiesHeldByAxis, sovietCityIncome } from "../src/engine/soviet-income";
import { runYearStartSequence } from "../src/engine/yearstart";
import type { ForceOwner, GameState, Scenario } from "../src/engine/types";
import { conquestLine } from "../src/ui/conquestText";
import { eventSide } from "../src/ui/logSide";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";
import { at6f, inf, move, okOf } from "./helpers-move";

// Spec 14 ticket 14-14, R7a (Ref 18.4, 9.2): the Axis capture of Moscow or Leningrad moves 15 BRPs from the U.S.S.R. to Germany at once, once for each city, and
// every Year Start Sequence in which the Axis holds a city moves another 15 each. TODO(verify) V22, V45, V46, V47.

const MOSCOW = "H47";
const LENINGRAD = "D44";

/** Germany and the U.S.S.R. at war, the U.S.S.R. with 60 BRPs and a spending limit of 30, Germany with 100 and 50. */
function atWar(tweak: Partial<GameState> = {}, scenario: Scenario = SCENARIO_1939): GameState {
  const base = board([], scenario);
  return {
    ...base,
    wars: [...base.wars, ["germany", "ussr"]],
    nations: {
      ...base.nations,
      ussr: { ...base.nations.ussr, status: "allied", brpTotal: 60, spendLimit: 30 },
      germany: { ...base.nations.germany, brpTotal: 100, spendLimit: 50 },
    },
    ...tweak,
  };
}

/** A ground unit of `owner` enters `hex`; returns the state and the events. */
function enter(s: GameState, owner: ForceOwner, hex: string, type: "infantry" | "armor" = "infantry") {
  const unit = counter(`u-${owner}-${hex}`, owner, type, 3, hex, 3);
  return enterHexes(CTX, { ...s, units: { ...s.units, [unit.id]: unit } }, unit, [hex]);
}

const totals = (s: GameState) => ({ ger: s.nations.germany.brpTotal, rus: s.nations.ussr.brpTotal, gerLimit: s.nations.germany.spendLimit, rusLimit: s.nations.ussr.spendLimit });

describe("the two cities on the map", () => {
  it("are found by name: Moscow H47 and Leningrad D44, and nothing else", () => {
    expect(sovietCityAt(CTX, MOSCOW)).toBe("moscow");
    expect(sovietCityAt(CTX, LENINGRAD)).toBe("leningrad");
    expect(sovietCityAt(CTX, "L31")).toBeNull();
    expect([...sovietCityHexes(CTX)].sort()).toEqual([LENINGRAD, MOSCOW]);
  });
});

describe("the first Axis capture (R7a)", () => {
  it("Moscow: Germany gains 15 and the U.S.S.R. loses 15 at once, the limits are not touched, and one event says so", () => {
    const r = enter(atWar(), "germany", MOSCOW);
    expect(totals(r.state)).toEqual({ ger: 115, rus: 45, gerLimit: 50, rusLimit: 30 });
    expect(r.state.soviet).toEqual({ citiesTaken: { moscow: true } });
    expect(r.events.filter((e) => e.type === "RUSSIA_BRPS_MOVED")).toEqual([{ type: "RUSSIA_BRPS_MOVED", city: "moscow", amount: 15, lost: 15 }]);
    expect(r.state.control[MOSCOW]).toBe("germany");
  });
  it("Leningrad pays the same, and independently of Moscow: two cities, two payments", () => {
    const one = enter(atWar(), "germany", MOSCOW).state;
    const two = enter(one, "germany", LENINGRAD).state;
    expect(totals(two)).toMatchObject({ ger: 130, rus: 30 });
    expect(two.soviet).toEqual({ citiesTaken: { moscow: true, leningrad: true } });
  });
  it("the event is written in the same step as the capture, after the control change", () => {
    const types = enter(atWar(), "germany", LENINGRAD).events.map((e) => e.type);
    expect(types.indexOf("HEX_CONTROL_CHANGED")).toBeLessThan(types.indexOf("RUSSIA_BRPS_MOVED"));
  });
  it("an Italian unit or a Minor-Ally's takes the city for the Axis; Germany is still the recipient (V22, V47)", () => {
    const it1 = enter(atWar({ nations: { ...atWar().nations, italy: { ...atWar().nations.italy, status: "axis" } } }), "italy", MOSCOW).state;
    expect(totals(it1)).toMatchObject({ ger: 115, rus: 45 });
    const fin = enter(atWar({ minorAllies: [{ owner: "finland", of: "germany", active: true }] }), "finland", LENINGRAD).state;
    expect(totals(fin)).toMatchObject({ ger: 115, rus: 45 });
  });
  it("armor and airborne take it too; the same entry by a unit that does not take hexes (an air unit) does nothing", () => {
    expect(totals(enter(atWar(), "germany", MOSCOW, "armor").state).ger).toBe(115);
    expect(enter(atWar(), "germany", MOSCOW, "infantry").state.soviet?.citiesTaken.moscow).toBe(true);
    const air = counter("a1", "germany", "air", 3, MOSCOW);
    const r = enterHexes(CTX, atWar({ units: { a1: air } }), air, [MOSCOW]);
    expect(r.events).toEqual([]);
    expect(r.state.nations.ussr.brpTotal).toBe(60);
  });
});

describe("once only (R7a)", () => {
  it("Moscow taken, retaken by the U.S.S.R. and taken again: the second capture moves nothing", () => {
    const first = enter(atWar(), "germany", MOSCOW).state;
    const back = enter(first, "ussr", MOSCOW).state;
    expect(back.control[MOSCOW]).toBe("ussr");
    const again = enter(back, "germany", MOSCOW);
    expect(again.state.control[MOSCOW]).toBe("germany");
    expect(totals(again.state)).toEqual(totals(back));
    expect(again.events.some((e) => e.type === "RUSSIA_BRPS_MOVED")).toBe(false);
    expect(again.state.soviet).toEqual({ citiesTaken: { moscow: true } });
  });
  it("lost and retaken four times is still one payment; a different city still pays its own", () => {
    let s = atWar();
    for (let i = 0; i < 4; i++) s = enter(enter(s, "germany", MOSCOW).state, "britain", MOSCOW).state;
    expect(totals(s)).toMatchObject({ ger: 115, rus: 45 });
    expect(totals(enter(s, "germany", LENINGRAD).state)).toMatchObject({ ger: 130, rus: 30 });
  });
  it("the Soviet side retaking a city moves nothing either", () => {
    const first = enter(atWar(), "germany", MOSCOW).state;
    const back = enter(first, "ussr", MOSCOW);
    expect(back.events.filter((e) => e.type === "RUSSIA_BRPS_MOVED")).toEqual([]);
    expect(totals(back.state)).toEqual(totals(first));
  });
});

describe("what does not count as a capture", () => {
  it("an Axis unit entering a city the Axis already holds, or a Soviet unit entering its own, moves nothing", () => {
    const held = atWar({ control: { [MOSCOW]: "germany" } });
    expect(enter(held, "germany", MOSCOW).events).toEqual([]);
    expect(enter(atWar(), "ussr", MOSCOW).events).toEqual([]);
  });
  it("the Allies taking a city from the Axis moves nothing, even one never paid for (an Axis-held city at the start, say)", () => {
    const axisHeld = atWar({ control: { [MOSCOW]: "germany" } });
    const r = enter(axisHeld, "ussr", MOSCOW);
    expect(r.state.control[MOSCOW]).toBe("ussr");
    expect(r.events.some((e) => e.type === "RUSSIA_BRPS_MOVED")).toBe(false);
    expect(totals(r.state)).toMatchObject({ ger: 100, rus: 60 });
    expect(r.state.soviet).toBeUndefined();
  });
  it("another hex of the U.S.S.R. is just a hex", () => {
    const r = enter(atWar(), "germany", "H48");
    expect(r.events.some((e) => e.type === "RUSSIA_BRPS_MOVED")).toBe(false);
    expect(totals(r.state)).toMatchObject({ ger: 100, rus: 60 });
  });
  it("a neutral U.S.S.R. (no war): the German unit takes nothing, so nothing moves", () => {
    const base = board([]);
    const r = enter(base, "germany", MOSCOW);
    expect(r.events).toEqual([]);
    expect(r.state.soviet).toBeUndefined();
  });
  it("sovietCityTaken refuses a hex that is not one of the two", () => {
    expect(sovietCityTaken(CTX, atWar(), "L31")).toBeNull();
  });
});

describe("amounts at the edges (V45)", () => {
  it("a U.S.S.R. with only 10 BRPs loses 10, never goes below 0, and Germany still gains the full 15", () => {
    const poor = atWar();
    poor.nations.ussr = { ...poor.nations.ussr, brpTotal: 10 };
    const r = enter(poor, "germany", MOSCOW);
    expect(totals(r.state)).toMatchObject({ ger: 115, rus: 0 });
    expect(r.events.find((e) => e.type === "RUSSIA_BRPS_MOVED")).toMatchObject({ amount: 15, lost: 10 });
  });
  it("exactly 15 leaves 0; 16 leaves 1", () => {
    for (const [have, left] of [[15, 0], [16, 1]] as const) {
      const s = atWar();
      s.nations.ussr = { ...s.nations.ussr, brpTotal: have };
      expect(enter(s, "germany", MOSCOW).state.nations.ussr.brpTotal, String(have)).toBe(left);
    }
  });
  it("the amount is the manual's 15", () => expect(SOVIET_CITY_BRPS).toBe(15));
});

describe("after the U.S.S.R. has left the game (R7a: these stop after a surrender)", () => {
  it("a conquered U.S.S.R. pays nothing at a capture", () => {
    const gone = atWar();
    gone.nations.ussr = { ...gone.nations.ussr, status: "conquered", brpTotal: 0 };
    expect(sovietCityOpen(gone)).toBe(false);
    expect(enter(gone, "germany", MOSCOW).events.some((e) => e.type === "RUSSIA_BRPS_MOVED")).toBe(false);
  });
  it("a Conquest record of the U.S.S.R. stops them even while the status is still allied (ticket 14-15 may set either)", () => {
    const surrendered = atWar({ conquests: [{ country: "ussr", by: "germany", side: "allies", how: "surrender", at: { year: 1941, season: "fall" } }] });
    expect(sovietCityOpen(surrendered)).toBe(false);
    expect(enter(surrendered, "germany", MOSCOW).state.soviet).toBeUndefined();
    expect(sovietCityIncome(CTX, { ...surrendered, control: { [MOSCOW]: "germany" } }, "germany")).toBe(0);
  });
  it("a conquered Germany gets nothing (its total stays 0) but the U.S.S.R. still loses its 15 (V47)", () => {
    const s = atWar();
    s.nations.germany = { ...s.nations.germany, status: "conquered", brpTotal: 0, spendLimit: 0 };
    const r = enter({ ...s, minorAllies: [{ owner: "finland", of: "germany", active: true }] }, "finland", MOSCOW);
    expect(totals(r.state)).toMatchObject({ ger: 0, rus: 45 });
  });
});

describe("by the real actions", () => {
  it("a MOVE of a German unit from the next hex into Moscow pays at once, in the Movement Phase", () => {
    const s = at6f([inf("g1", "germany", "H48", 3, 3)], "axis", SCENARIO_1939, { wars: [["germany", "ussr"]], nations: atWar().nations });
    const r = okOf(move(s, ["g1"], [MOSCOW]));
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal + 15);
    expect(r.state.nations.ussr.brpTotal).toBe(60 - 15);
    expect(r.events.filter((e) => e.type === "RUSSIA_BRPS_MOVED")).toHaveLength(1);
  });
});

describe("by an advance after a won battle", () => {
  it("the survivors of an attack on Moscow advance into the empty city: the 15 are paid then", () => {
    const base = at6f([inf("g1", "germany", "H48", 3, 3)], "axis", SCENARIO_1939, { wars: [["germany", "ussr"]], nations: atWar().nations });
    const s: GameState = { ...base, position: { part: "player-turn", turn: 1, step: "7h" }, combat: { turn: turnKey(base), attacked: [], targets: [MOSCOW], pending: null, advances: [{ to: MOSCOW, units: ["g1"] }] } };
    const r = okOf(applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: ["g1"], to: MOSCOW }));
    expect(r.state.nations.ussr.brpTotal).toBe(45);
    expect(r.state.nations.germany.brpTotal).toBe(115);
    expect(r.events.filter((e) => e.type === "RUSSIA_BRPS_MOVED")).toHaveLength(1);
  });
});

describe("the Year Start Sequence (R7a)", () => {
  const held = (...hexes: string[]): Partial<GameState> => ({ control: Object.fromEntries(hexes.map((h) => [h, "germany"] as const)), year: 1942, season: "spring" });
  const plain = (s: GameState) => runYearStartSequence(CTX, { ...s, control: {} }).state; // the same year with neither city held

  it("holding Moscow: Germany +15, the U.S.S.R. -15, and the spending limits are half the new totals", () => {
    const s = atWar(held(MOSCOW));
    const r = runYearStartSequence(CTX, s).state;
    const p = plain(s);
    expect(r.nations.germany.brpTotal - p.nations.germany.brpTotal).toBe(15);
    expect(p.nations.ussr.brpTotal - r.nations.ussr.brpTotal).toBe(15);
    expect(r.nations.germany.spendLimit).toBe(Math.floor(r.nations.germany.brpTotal / 2));
    expect(r.nations.ussr.spendLimit).toBe(Math.floor(r.nations.ussr.brpTotal / 2));
  });
  it("holding both: 30 each way; holding neither: nothing; the Allies holding them: nothing", () => {
    const both = runYearStartSequence(CTX, atWar(held(MOSCOW, LENINGRAD))).state;
    const p = plain(atWar());
    expect(both.nations.germany.brpTotal - p.nations.germany.brpTotal).toBe(30);
    expect(p.nations.ussr.brpTotal - both.nations.ussr.brpTotal).toBe(30);
    expect(citiesHeldByAxis(CTX, atWar())).toBe(0);
    expect(sovietCityIncome(CTX, atWar(), "germany")).toBe(0);
    expect(citiesHeldByAxis(CTX, atWar({ control: { [MOSCOW]: "britain" } }))).toBe(0);
  });
  it("it is every sequence: two years in a row pay twice (and no immediate payment was ever made)", () => {
    const s = atWar(held(MOSCOW));
    const y1 = runYearStartSequence(CTX, s).state;
    const y2 = runYearStartSequence(CTX, { ...y1, year: 1943 }).state;
    const noCity = runYearStartSequence(CTX, { ...runYearStartSequence(CTX, { ...s, control: {} }).state, year: 1943 }).state;
    expect(y2.nations.germany.brpTotal).toBeGreaterThan(noCity.nations.germany.brpTotal);
    expect(sovietCityIncome(CTX, y2, "germany")).toBe(15);
    expect(sovietCityIncome(CTX, y2, "ussr")).toBe(-15);
  });
  it("also held by an Italian unit or a Minor-Ally: held by the Axis", () => {
    expect(citiesHeldByAxis(CTX, atWar({ control: { [MOSCOW]: "italy", [LENINGRAD]: "finland" }, minorAllies: [{ owner: "finland", of: "germany", active: true }], nations: { ...atWar().nations, italy: { ...atWar().nations.italy, status: "axis" } } }))).toBe(2);
  });
  it("nobody else is touched: Britain, France, Italy and the U.S.A. get 0 from the cities", () => {
    const s = atWar(held(MOSCOW, LENINGRAD));
    for (const id of ["britain", "france", "italy", "usa"] as const) expect(sovietCityIncome(CTX, s, id), id).toBe(0);
  });
  it("the U.S.S.R. never goes below 0 BRPs (V46)", () => {
    const s = atWar(held(MOSCOW, LENINGRAD));
    s.nations.ussr = { ...s.nations.ussr, brpBase: 10, brpTotal: 10, growthRate: 0 };
    const r = runYearStartSequence(CTX, s).state;
    expect(r.nations.ussr.brpTotal).toBe(0);
    expect(r.nations.ussr.spendLimit).toBe(0);
  });
  it("the log line says so: a plus line for Germany and a minus line for the U.S.S.R., naming both cities", () => {
    const events = runYearStartSequence(CTX, atWar(held(MOSCOW, LENINGRAD))).events;
    const ger = events.find((e) => e.type === "BRPS_CHANGED" && e.nation === "germany");
    const rus = events.find((e) => e.type === "BRPS_CHANGED" && e.nation === "ussr");
    expect(ger && ger.type === "BRPS_CHANGED" && ger.reason).toMatch(/plus 30 for Moscow and Leningrad held by the Axis/);
    expect(rus && rus.type === "BRPS_CHANGED" && rus.reason).toMatch(/less 30 for Moscow and Leningrad held by the Axis/);
  });
  it("the log names only the cities the Axis holds: Leningrad alone, then Moscow alone", () => {
    for (const [hex, name] of [[LENINGRAD, "Leningrad"], [MOSCOW, "Moscow"]] as const) {
      const events = runYearStartSequence(CTX, atWar(held(hex))).events;
      for (const nation of ["germany", "ussr"] as const) {
        const line = events.find((e) => e.type === "BRPS_CHANGED" && e.nation === nation);
        expect(line && line.type === "BRPS_CHANGED" && line.reason, nation).toMatch(new RegExp(`(plus|less) 15 for ${name} held by the Axis`));
      }
    }
  });
  it("the reason no longer counts conquered countries or the cities as Minor-Allies' BRPs", () => {
    const events = runYearStartSequence(ctxFor(SCENARIO_1942), { ...board([], SCENARIO_1942, { year: 1943, season: "spring" }), control: { [MOSCOW]: "germany" }, wars: [["germany", "ussr"]] }).events;
    const ger = events.find((e) => e.type === "BRPS_CHANGED" && e.nation === "germany");
    expect(ger && ger.type === "BRPS_CHANGED" && ger.reason).toMatch(/plus 45 from Minor-Allies \([^)]*\), plus 15 for Moscow/);
  });
  it("a U.S.S.R. that has left the game gets and gives nothing (the sequence skips it; Germany's +15 stops too)", () => {
    const s = atWar({ ...held(MOSCOW, LENINGRAD), conquests: [{ country: "ussr", by: "germany", side: "allies", how: "surrender", at: { year: 1941, season: "fall" } }] });
    const r = runYearStartSequence(CTX, s).state;
    const p = runYearStartSequence(CTX, { ...s, control: {} }).state;
    expect(r.nations.germany.brpTotal).toBe(p.nations.germany.brpTotal);
  });
  it("an older saved game with no `soviet` record runs the sequence the same way", () => {
    const s = atWar(held(MOSCOW));
    expect(s.soviet).toBeUndefined();
    expect(() => runYearStartSequence(CTX, s)).not.toThrow();
  });
});

describe("the log words (R7a)", () => {
  it("the first capture says who gains and who loses, in words, with no raw ids", () => {
    const line = conquestLine(CTX, { type: "RUSSIA_BRPS_MOVED", city: "moscow", amount: 15, lost: 15 });
    expect(line).toBe("The Axis takes Moscow for the first time: +15 BRPs for Germany, -15 BRPs for the Soviet Union.");
    expect(conquestLine(CTX, { type: "RUSSIA_BRPS_MOVED", city: "leningrad", amount: 15, lost: 4 })).toBe("The Axis takes Leningrad for the first time: +15 BRPs for Germany, -4 BRPs for the Soviet Union.");
    expect(conquestLine(CTX, { type: "RUSSIA_BRPS_MOVED", city: "moscow", amount: 15, lost: 0 })).toBe("The Axis takes Moscow for the first time: +15 BRPs for Germany, no BRPs lost for the Soviet Union.");
  });
  it("the line is the Axis's (its colour in the activity log), whoever's action set it off", () => {
    expect(eventSide({ type: "RUSSIA_BRPS_MOVED", city: "moscow", amount: 15, lost: 15 }, "allies")).toBe("axis");
  });
});
