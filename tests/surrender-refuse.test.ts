import { describe, expect, it } from "vitest";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction } from "../src/engine/actions";
import { conquestIncome } from "../src/engine/conquest-income";
import { controllerOf, enterHexes } from "../src/engine/control";
import { sovietCityOpen } from "../src/engine/soviet";
import { russianFactorsInRussia, settleSoviet } from "../src/engine/soviet-surrender";
import { advance, settle } from "../src/engine/turn";
import { runYearStartSequence } from "../src/engine/yearstart";
import type { GameState, Unit } from "../src/engine/types";
import { counter } from "./board";
import { CTX, ctxFor } from "./helpers";
import { air, answer, askedWith, at9k, eventsOf, ger, IN, LENINGRAD, many, MOSCOW, OUT, rus } from "./helpers-surrender";

// Spec 14 ticket 14-15, R7d (Ref 18.41): the Axis refuse. Russia stays in the game, the offer is not made again, Moscow and Leningrad keep their 15s, and Russia is conquered when its
// last ground or air factor inside its original borders is gone (checked after every Combat Phase and after the unsupplied-unit eliminations). TODO(verify) V18, V20, V49.

const units = (): Unit[] => [...many("r", "ussr", 10, 4, IN.slice(0, 5)), rus("rout", OUT, 5), air("rair", "ussr", IN[0], 2), ...many("g", "germany", 18, 4, IN.slice(5)), ger("gout", OUT), counter("brit", "britain", "infantry", 3, "A47", 3)];
const refused = (tweak: Partial<GameState> = {}) => answer(askedWith(units(), tweak), false);

/** The refused game at the end of the Axis Combat Phase: only the units in `keep` are left of the Russians. */
function atEndOfCombat(keep: string[], tweak: Partial<GameState> = {}): GameState {
  const s = refused(tweak).state;
  const left = Object.fromEntries(Object.entries(s.units).filter(([id, u]) => u.owner !== "ussr" || keep.includes(id)));
  return { ...s, units: left, activeSide: "axis", firstSide: "axis", position: { part: "player-turn", turn: 1, step: "7p" } };
}

describe("what the Axis refuse (R7d)", () => {
  const before = askedWith(units());
  const done = answer(before, false);
  const after = done.state;
  it("the record says refused, one event says so, the game goes on to 10b", () => {
    expect(after.soviet?.offer).toBe("refused");
    expect(eventsOf(done.events, "SURRENDER_REFUSED")).toEqual([{ type: "SURRENDER_REFUSED" }]);
    expect(after.position).toEqual({ part: "player-turn", turn: 2, step: "10b" });
  });
  it("nothing else changes: the units, the pools, the nations, the control, the wars", () => {
    expect({ ...after, soviet: undefined, position: undefined }).toEqual({ ...before, soviet: undefined, position: undefined });
    expect(after.conquests).toBeUndefined();
    expect(after.nations.ussr.status).toBe("allied");
  });
  it("Moscow and Leningrad keep their 15s: a capture pays, the cities are open", () => {
    expect(sovietCityOpen(after)).toBe(true);
    const unit = counter("gm", "germany", "infantry", 3, MOSCOW, 3);
    const r = enterHexes(CTX, { ...after, units: { ...after.units, gm: unit } }, unit, [MOSCOW]);
    expect(eventsOf(r.events, "RUSSIA_BRPS_MOVED")).toHaveLength(1);
  });
  it("the Year Start Sequence still moves the 15s for a city the Axis hold", () => {
    const spring = { ...after, season: "spring" as const, year: 1942 };
    const held = { ...spring, control: { ...after.control, [LENINGRAD]: "germany" as const } };
    expect(runYearStartSequence(CTX, spring).state.nations.ussr.brpTotal - runYearStartSequence(CTX, held).state.nations.ussr.brpTotal).toBe(15);
    expect(runYearStartSequence(CTX, held).state.nations.germany.brpTotal - runYearStartSequence(CTX, spring).state.nations.germany.brpTotal).toBe(15);
  });
  it("no income for Germany yet: Russia is not conquered", () => {
    expect(conquestIncome(CTX, after, "germany")).toBe(0);
  });
  it("Russian land stays open to the Axis: the war goes on", () => {
    expect(after.wars.some((w) => w.includes("ussr"))).toBe(true);
  });
  it("the offer is not made again at a later 10a, although the test is still met", () => {
    const again = settle(CTX, { ...after, position: { part: "player-turn", turn: 2, step: "9k" } });
    expect(eventsOf(again.events, "RUSSIA_OFFERS_SURRENDER")).toEqual([]);
    expect(again.state.position).toMatchObject({ step: "10b" });
  });
});

describe("the last factor inside Russia (R7d, V20)", () => {
  it("the end of the Axis Combat Phase with no Russian factor inside Russia: Germany conquers the U.S.S.R. 'by the last unit'", () => {
    const s = atEndOfCombat(["rout"]);
    expect(russianFactorsInRussia(CTX, s)).toBe(0);
    const r = advance(CTX, s);
    expect(r.state.conquests).toEqual([expect.objectContaining({ country: "ussr", by: "germany", side: "allies", how: "last-unit" })]);
    expect(r.state.nations.ussr).toMatchObject({ status: "conquered", brpTotal: 0 });
    expect(eventsOf(r.events, "COUNTRY_CONQUERED")).toMatchObject([{ country: "ussr", how: "last-unit", by: "germany" }]);
  });
  it("it conquers like any Power (V20): every Russian unit goes, also the one outside Russia, the pool goes, the Russian land passes to Germany", () => {
    const s = atEndOfCombat(["rout"]);
    const r = advance(CTX, s);
    expect(Object.values(r.state.units).filter((u) => u.owner === "ussr")).toEqual([]);
    expect(r.state.pools.ussr).toBeUndefined();
    expect(controllerOf(CTX, r.state, "A49")).toBe("germany");
    expect(controllerOf(CTX, r.state, MOSCOW)).toBe("germany");
    expect(eventsOf(r.events, "CONTROL_PASSED").some((e) => e.to === "germany" && e.hexes.includes(MOSCOW))).toBe(true);
  });
  it("one Russian factor left inside Russia stops it: a ground unit, an air unit, or a replacement", () => {
    for (const keep of [["r1"], ["rair"]]) {
      const r = advance(CTX, atEndOfCombat(keep));
      expect(r.state.conquests, keep.join()).toBeUndefined();
      expect(r.state.nations.ussr.status).toBe("allied");
    }
  });
  it("Russian units outside Russia do not keep it alive", () => {
    expect(advance(CTX, atEndOfCombat(["rout"])).state.conquests).toHaveLength(1);
  });
  it("it is checked at the end of the Allied Combat Phase too", () => {
    const s = { ...atEndOfCombat(["rout"]), activeSide: "allies" as const, firstSide: "axis" as const, position: { part: "player-turn" as const, turn: 2 as const, step: "7p" } };
    expect(advance(CTX, s).state.conquests).toHaveLength(1);
  });
  it("it is checked at the end of the Player Turn too, after the unsupplied units are gone", () => {
    const s = { ...atEndOfCombat(["rout"]), position: { part: "player-turn" as const, turn: 1 as const, step: "10b" } };
    const r = advance(CTX, s);
    expect(r.state.conquests).toEqual([expect.objectContaining({ country: "ussr", how: "last-unit" })]);
    expect(r.state.position).toMatchObject({ turn: 2, step: "1" }); // the game was not decided: the second Player Turn begins (the next test is a decided game)
  });
  it("it is not checked at any other step: a Russian army wiped out in the Movement Phase is found at the end of the Combat Phase", () => {
    const s = { ...atEndOfCombat(["rout"]), position: { part: "player-turn" as const, turn: 1 as const, step: "6f" } };
    expect(advance(CTX, s).state.conquests).toBeUndefined();
  });
  it("without a refusal there is no such conquest: not when nothing was offered, not while the offer waits", () => {
    for (const offer of [undefined, "asking", "none"] as const) {
      const s = atEndOfCombat(["rout"]);
      const t = { ...s, soviet: offer === undefined ? undefined : { citiesTaken: {}, offer } } as GameState;
      expect(settleSoviet(CTX, t).state.conquests, String(offer)).toBeUndefined();
    }
  });
  it("not when Russia has left the game already (accepted), nor when Germany has", () => {
    const accepted = { ...atEndOfCombat(["rout"]), soviet: { citiesTaken: {}, offer: "accepted" as const } };
    expect(settleSoviet(CTX, accepted).events).toEqual([]);
    const s = atEndOfCombat(["rout"]);
    const noGermany = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, status: "conquered" as const } } };
    expect(settleSoviet(CTX, noGermany).events).toEqual([]);
  });
  it("once conquered it stays so: a second look does nothing", () => {
    const first = advance(CTX, atEndOfCombat(["rout"])).state;
    expect(settleSoviet(CTX, first).events).toEqual([]);
  });
  it("the 15s stop with the conquest, and Germany gets half of Russia's starting BRPs from the next Year Start Sequence whether or not it holds Moscow (V48)", () => {
    const r = advance(CTX, atEndOfCombat(["rout"])).state;
    expect(sovietCityOpen(r)).toBe(false);
    expect(conquestIncome(CTX, r, "germany")).toBe(Math.floor(CTX.scenario.nations.ussr.brpTotal / 2));
    const lost = { ...r, control: { ...r.control, [MOSCOW]: "britain" as const } };
    expect(conquestIncome(CTX, lost, "germany")).toBe(Math.floor(CTX.scenario.nations.ussr.brpTotal / 2)); // V48: no capital is needed
  });
  it("the Campaign: with Britain and France conquered, the last Russian factor decides the game at once", () => {
    const ctx = ctxFor(SCENARIO_CAMPAIGN);
    const conquests = [{ country: "britain" as const, by: "germany" as const, side: "allies" as const, how: "capital" as const, at: { year: 1941, season: "fall" as const } }, { country: "france" as const, by: "germany" as const, side: "allies" as const, how: "capital" as const, at: { year: 1940, season: "spring" as const } }];
    const s0 = answer(askedWith(units(), { conquests }, SCENARIO_CAMPAIGN), false, ctx).state;
    const s = { ...s0, units: Object.fromEntries(Object.entries(s0.units).filter(([, u]) => u.owner !== "ussr")), position: { part: "player-turn" as const, turn: 2 as const, step: "10b" } };
    const r = advance(ctx, s);
    expect(r.state.phase).toBe("game-over");
    expect(r.state.result).toMatchObject({ winner: "axis", level: "decisive", basis: "powers-conquered", early: true });
    expect(r.events.at(-1)!.type).toBe("GAME_OVER");
    expect(r.state.activeSide).toBe("allies"); // no second Player Turn or next Game Turn was begun
    expect(r.state.position).toEqual({ part: "player-turn", turn: 2, step: "10b" });
    expect(applyAction(ctx, r.state, { type: "END_PLAYER_TURN", side: "allies" }).ok).toBe(false);
  });
});

describe("old games", () => {
  it("a state with no Russian record, or with the old record of the 15s only, reads as 'no offer yet' and plays on", () => {
    const old = at9k([...many("r", "ussr", 12), ...many("g", "germany", 2, 4, IN.slice(5))], { soviet: { citiesTaken: { moscow: true } } });
    const r = settle(CTX, old);
    expect(r.state.position).toMatchObject({ step: "10b" });
    expect(r.state.soviet).toEqual({ citiesTaken: { moscow: true } });
    expect(JSON.parse(JSON.stringify(r.state))).toEqual(r.state);
  });
});
