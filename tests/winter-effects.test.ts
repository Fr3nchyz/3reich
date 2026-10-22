import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction, legalActions, type Action, type GameEvent } from "../src/engine/actions";
import { attackNumbers, defendersAt } from "../src/engine/attack-rules";
import { frontOptionOf, legalFrontOptions, WINTER_BAN_TEXT } from "../src/engine/frontoptions";
import { defenseBasis, defenseMultiplier } from "../src/engine/terrain";
import type { GameState, MinorAlly, Unit } from "../src/engine/types";
import { winterBansOffensive, winterDefence } from "../src/engine/winter-effects";
import { winterInForce } from "../src/engine/winter-record";
import { attackPreview } from "../src/ui/attackPreview";
import { CTX, ctxFor } from "./helpers";
import { allied7h, axis3, ger, KEY, MOUNTAIN, OUTSIDE, PLAIN, RIVER, rus, SWAMP, WINTER } from "./helpers-winter";
import { runGame } from "../scripts/selfplay/runner";

// Spec 14 ticket 14-12 (R10; Ref 28.0): what the Russian winter does to the fighting. The plain doubling of an Axis defender east of the original Russian border
// is lost (the Finns excepted; the triples and the Fortress stay); the Axis may not take the Offensive Option on the Eastern Front. Only in the Game Turn it is in force.

const numbersAt = (s: GameState, attackers: Unit[], target: string) => attackNumbers(CTX, s, attackers, defendersAt(s, attackers, target), target);

describe("terrain.ts: the basis \"winter\" takes away only the plain doubling", () => {
  it("plain country is doubled without the winter and counted once with it, with the reason \"winter\"", () => {
    expect(defenseBasis({ terrain: "plain" })).toEqual({ multiplier: 2, basis: "plain" });
    expect(defenseBasis({ terrain: "plain", winter: true })).toEqual({ multiplier: 1, basis: "winter" });
    expect(defenseMultiplier({ terrain: "plain", winter: true })).toBe(1);
  });
  it("mountains, swamp, a river or arrow and a beach against an invasion stay tripled, and a Fortress stays quadrupled (V23)", () => {
    expect(defenseBasis({ terrain: "mountains", winter: true })).toEqual({ multiplier: 3, basis: "mountains" });
    expect(defenseBasis({ terrain: "swamp", winter: true })).toEqual({ multiplier: 3, basis: "swamp" });
    expect(defenseBasis({ terrain: "plain", behindRiverOrArrow: true, winter: true })).toEqual({ multiplier: 3, basis: "river-or-arrow" });
    expect(defenseBasis({ terrain: "plain", features: ["beach"], seaborneInvasion: true, winter: true })).toEqual({ multiplier: 3, basis: "beach-invasion" });
    expect(defenseBasis({ terrain: "plain", fortress: true, winter: true })).toEqual({ multiplier: 4, basis: "fortress" });
    expect(defenseBasis({ terrain: "mountains", fortress: true, winter: true }).multiplier).toBe(4);
  });
  it("the flag absent or false changes nothing", () => {
    expect(defenseBasis({ terrain: "plain", winter: false })).toEqual({ multiplier: 2, basis: "plain" });
  });
});

describe("winterDefence: which defences lose the doubling (Ref 28.0, V23)", () => {
  const defend = (units: Unit[], at: string = PLAIN.at, tweak: Partial<GameState> = {}, winter: GameState["winter"] | null = WINTER) => {
    const s = allied7h(units, tweak, winter);
    return winterDefence(CTX, s, defendersAt(s, [rus("r", PLAIN.from)], at), at);
  };
  it("an Axis unit in the country ussr, the winter in force: yes", () => expect(defend([ger("g", PLAIN.at)])).toBe(true));
  it("the same unit outside Russia: no", () => expect(defend([ger("g", OUTSIDE.at)], OUTSIDE.at)).toBe(false));
  it("the winter not in force (no record, a postponed winter, an old winter, the scenario's past winter): no", () => {
    const g = [ger("g", PLAIN.at)];
    expect(defend(g, PLAIN.at, {}, null)).toBe(false);
    expect(defend(g, PLAIN.at, {}, { stage: "postponed", asking: false, postponedFrom: { year: 1941, season: "winter" } })).toBe(false);
    expect(defend(g, PLAIN.at, {}, { stage: "over", inForce: "1940-winter", asking: false })).toBe(false);
    expect(defend(g, PLAIN.at, { season: "spring", year: 1942 })).toBe(false);
    expect(defend(g, PLAIN.at, {}, { stage: "ahead", asking: true })).toBe(false);
  });
  it("Italian and Rumanian units suffer it too, an active Minor-Ally's included (V23)", () => {
    const ally: MinorAlly[] = [{ owner: "rumania", of: "germany", active: true }];
    const base = allied7h([]);
    expect(defend([ger("i", PLAIN.at, "italy")], PLAIN.at, { wars: [["germany", "ussr"], ["italy", "ussr"]], nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } } })).toBe(true);
    expect(defend([ger("r", PLAIN.at, "rumania")], PLAIN.at, { minorAllies: ally })).toBe(true);
  });
  it("the Finns keep the doubling when they are alone in the hex, and lose it when a non-Finnish Axis unit stands with them (V23)", () => {
    expect(defend([ger("f", PLAIN.at, "finland")])).toBe(false);
    expect(defend([ger("f", PLAIN.at, "finland"), ger("g", PLAIN.at)])).toBe(true);
  });
  it("Allied defenders never lose it, in Russia or elsewhere", () => {
    const s = allied7h([rus("r", PLAIN.at), ger("g", PLAIN.from)], { activeSide: "axis" });
    expect(winterDefence(CTX, s, defendersAt(s, [ger("g", PLAIN.from)], PLAIN.at), PLAIN.at)).toBe(false);
  });
});

describe("attackNumbers under the winter (the one function behind the preview and the battle)", () => {
  it("a German unit on plain Russian ground counts once: 3 factors are 3 to beat, not 6", () => {
    const s = allied7h([ger("g", PLAIN.at), rus("r", PLAIN.from)]);
    const n = numbersAt(s, [s.units.r!], PLAIN.at);
    expect(n).toMatchObject({ multiplier: 1, basis: "winter", defenseFactors: 3, attackFactors: 4 });
    expect(n.column).toBe("1-1");
    const summer = numbersAt({ ...s, season: "summer" }, [s.units.r!], PLAIN.at);
    expect(summer).toMatchObject({ multiplier: 2, basis: "plain" });
    expect(summer.column).toBe("1-2");
  });
  it("mountains, swamp and a river stay tripled, a Fortress quadrupled", () => {
    const m = allied7h([ger("g", MOUNTAIN.at), rus("r", MOUNTAIN.from)]);
    expect(numbersAt(m, [m.units.r!], MOUNTAIN.at)).toMatchObject({ multiplier: 3, basis: "mountains" });
    const w = allied7h([ger("g", SWAMP.at), rus("r", SWAMP.from)]);
    expect(numbersAt(w, [w.units.r!], SWAMP.at)).toMatchObject({ multiplier: 3, basis: "swamp" });
    const r = allied7h([ger("g", RIVER.at), rus("r", RIVER.from)]);
    expect(numbersAt(r, [r.units.r!], RIVER.at)).toMatchObject({ multiplier: 3, basis: "river-or-arrow" });
    const f = allied7h([ger("g", PLAIN.at), rus("r", PLAIN.from)], { fortresses: { [PLAIN.at]: true } });
    expect(numbersAt(f, [f.units.r!], PLAIN.at)).toMatchObject({ multiplier: 4, basis: "fortress" });
  });
  it("an attacker not across the river takes the river bonus away and the defence counts once (winter), not twice", () => {
    const s = allied7h([ger("g", RIVER.at), rus("r", RIVER.from), rus("o", RIVER.other)]);
    expect(numbersAt(s, [s.units.r!, s.units.o!], RIVER.at)).toMatchObject({ multiplier: 1, basis: "winter" });
  });
  it("outside Russia the Germans are doubled as ever, in the same winter", () => {
    const s = allied7h([ger("g", OUTSIDE.at), rus("r", OUTSIDE.from)]);
    expect(numbersAt(s, [s.units.r!], OUTSIDE.at)).toMatchObject({ multiplier: 2, basis: "plain" });
  });
  it("Finns alone are doubled in Russia; Finns with a German are not", () => {
    const f = allied7h([ger("f", PLAIN.at, "finland"), rus("r", PLAIN.from)]);
    expect(numbersAt(f, [f.units.r!], PLAIN.at)).toMatchObject({ multiplier: 2, basis: "plain" });
    const mixed = allied7h([ger("f", PLAIN.at, "finland"), ger("g", PLAIN.at), rus("r", PLAIN.from)]);
    expect(numbersAt(mixed, [mixed.units.r!], PLAIN.at)).toMatchObject({ multiplier: 1, basis: "winter", defenseFactors: 6 });
  });
  it("Russian defenders keep their doubling in Russia in the winter (the Axis attacking)", () => {
    const s = allied7h([rus("r", PLAIN.at), ger("g", PLAIN.from)], { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" } });
    expect(numbersAt(s, [s.units.g!], PLAIN.at)).toMatchObject({ multiplier: 2, basis: "plain" });
  });
});

describe("the preview and the battle are one number (Ref 28.0 in the attack card)", () => {
  /** Every ATTACK the engine lists on the hex, the preview of the same attackers, and the battle that follows. */
  function bothAgree(s: GameState, target: string) {
    const attack = legalActions(CTX, s).find((a): a is Extract<Action, { type: "ATTACK" }> => a.type === "ATTACK" && a.target === target)!;
    expect(attack).toBeDefined();
    const p = attackPreview(CTX, s, target, attack.units);
    const r = applyAction(CTX, s, attack);
    if (!r.ok) throw new Error(r.error);
    const battle = r.events.find((e): e is Extract<GameEvent, { type: "COMBAT_RESOLVED" }> => e.type === "COMBAT_RESOLVED")!;
    return { p, battle };
  }
  it("under the winter the preview says Russian winter x1, the odds, and the battle was fought at exactly that multiplier, defence and attack", () => {
    const s = allied7h([ger("g", PLAIN.at), rus("r", PLAIN.from, 4), rus("q", PLAIN.from, 5)]);
    const { p, battle } = bothAgree(s, PLAIN.at);
    expect(p.numbers).toMatchObject({ multiplier: 1, basis: "winter", multiplierReason: "Russian winter: Axis defence not doubled", defenseTotal: 3 });
    expect(battle).toMatchObject({ multiplier: p.numbers!.multiplier, defenseFactors: p.numbers!.defenseFactors, attackFactors: p.numbers!.attackFactors });
    expect(battle.rounds[0]!.column).toBe(p.numbers!.column);
  });
  it("without the winter the same position is x2 in both", () => {
    const s = allied7h([ger("g", PLAIN.at), rus("r", PLAIN.from, 4), rus("q", PLAIN.from, 5)], {}, null);
    const { p, battle } = bothAgree(s, PLAIN.at);
    expect(p.numbers).toMatchObject({ multiplier: 2, basis: "plain", multiplierReason: "plain country: doubled", defenseTotal: 6 });
    expect(battle).toMatchObject({ multiplier: 2, defenseFactors: 3 });
    expect(battle.rounds[0]!.column).toBe(p.numbers!.column);
  });
  it("3 against 3 is column 1-1 under the winter (it would be 3 against 6, column 1-2, with the doubling)", () => {
    const s = allied7h([ger("g", PLAIN.at, "germany", 3), rus("r", PLAIN.from, 3)]);
    const p = attackPreview(CTX, s, PLAIN.at, ["r"]);
    expect(p.numbers).toMatchObject({ defenseTotal: 3, attackFactors: 3, column: "1-1" });
  });
});

describe("only the winter Game Turn: both Player Turns, then never again", () => {
  const withKey = (turn: { year: number; season: GameState["season"] }, winter = WINTER) => ({ ...allied7h([]), ...turn, winter });
  it("is in force for the Axis and the Allied Player Turn of the Game Turn it started in, and in no other", () => {
    expect(winterInForce(withKey({ year: 1941, season: "winter" }))).toBe(true);
    expect(winterInForce({ ...withKey({ year: 1941, season: "winter" }), activeSide: "axis" })).toBe(true);
    for (const t of [{ year: 1942, season: "spring" }, { year: 1941, season: "fall" }, { year: 1942, season: "winter" }] as const) expect(winterInForce(withKey(t))).toBe(false);
  });
  it("the defence is doubled again in the Spring after the winter, and in the next Winter turn (the rule never applies twice)", () => {
    const units = [ger("g", PLAIN.at), rus("r", PLAIN.from)];
    const spring = allied7h(units, { year: 1942, season: "spring" });
    expect(numbersAt(spring, [spring.units.r!], PLAIN.at).multiplier).toBe(2);
    const next = allied7h(units, { year: 1942, season: "winter" });
    expect(numbersAt(next, [next.units.r!], PLAIN.at).multiplier).toBe(2);
  });
  it("a winter the Allies postponed has no effect that turn, and the 1942 scenario's past winter none ever", () => {
    const units = [ger("g", PLAIN.at), rus("r", PLAIN.from)];
    const postponed = allied7h(units, {}, { stage: "postponed", asking: false, postponedFrom: { year: 1941, season: "winter" } });
    expect(numbersAt(postponed, [postponed.units.r!], PLAIN.at).multiplier).toBe(2);
    const s42 = allied7h(units, { year: 1942 }, null, SCENARIO_1942);
    expect(numbersAt(s42, [s42.units.r!], PLAIN.at).multiplier).toBe(2);
  });
});

describe("step 3: the Axis Offensive Option on the Eastern Front (Ref 28.0)", () => {
  const offered = (s: GameState, front: string, option: string, ctx = CTX) => legalFrontOptions(ctx, s).some((a) => a.type === "SELECT_FRONT_OPTION" && a.front === front && a.option === option);
  const choose = (s: GameState, front: "western" | "eastern" | "mediterranean", option: "offensive" | "attrition" | "defensive") =>
    applyAction(CTX, s, { type: "SELECT_FRONT_OPTION", side: "axis", front, option, ...(option === "offensive" ? { payer: "germany" as const } : {}) });

  it("hides the Eastern Offensive Option and offers every other choice", () => {
    const s = axis3();
    expect(offered(s, "eastern", "offensive")).toBe(false);
    for (const [front, option] of [["eastern", "attrition"], ["eastern", "defensive"], ["western", "offensive"], ["western", "attrition"], ["mediterranean", "offensive"], ["mediterranean", "defensive"]] as const) expect(offered(s, front, option), `${front} ${option}`).toBe(true);
  });
  it("offers it when the winter is not in force: before, after, postponed, the scenario's past winter", () => {
    expect(offered(axis3(null), "eastern", "offensive")).toBe(true);
    expect(offered(axis3(WINTER, { year: 1942, season: "spring" }), "eastern", "offensive")).toBe(true);
    expect(offered(axis3({ stage: "postponed", asking: false, postponedFrom: { year: 1941, season: "winter" } }), "eastern", "offensive")).toBe(true);
    expect(offered(axis3(null, { year: 1942 }), "eastern", "offensive", ctxFor(SCENARIO_1942))).toBe(true);
  });
  it("refuses the action with the reason, spends nothing and records nothing; the other Options are taken as ever", () => {
    const s = axis3();
    const r = choose(s, "eastern", "offensive");
    expect(r).toEqual({ ok: false, error: WINTER_BAN_TEXT });
    expect(WINTER_BAN_TEXT).toContain("Russian winter");
    const ok = choose(s, "eastern", "attrition");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(frontOptionOf(ok.state, "eastern")).toBe("attrition");
    const west = choose(s, "western", "offensive");
    expect(west.ok).toBe(true);
    if (west.ok) expect(west.state.nations.germany.spent).toBe(15);
  });
  it("after a refusal the game is untouched, and the Axis can still go on (a legal list that is not empty, END_STEP among it)", () => {
    const s = axis3();
    expect(legalActions(CTX, s).some((a) => a.type === "END_STEP")).toBe(true);
  });
  it("does not touch the Allies: their Eastern Offensive Option is offered in the same winter", () => {
    const s = allied7h([], { position: { part: "player-turn", turn: 2, step: "3" }, nations: { ...allied7h([]).nations, ussr: { ...allied7h([]).nations.ussr, status: "allied", brpTotal: 100, spent: 0 } } });
    expect(legalFrontOptions(CTX, s).some((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "eastern" && a.option === "offensive")).toBe(true);
    expect(winterBansOffensive(s, "allies", "eastern", "offensive")).toBe(false);
    expect(winterBansOffensive(s, "axis", "eastern", "offensive")).toBe(true);
    expect(winterBansOffensive(s, "axis", "eastern", "attrition")).toBe(false);
    expect(winterBansOffensive(s, "axis", "western", "offensive")).toBe(false);
  });
  it("applies in a winter that began by a Russian declaration too (the same record), and not before it began", () => {
    // Russia declares in the Allied turn of a Winter game turn: the record is made at once (14-11); the Axis turn of the next Game Turn is Spring, so only a later Winter has none
    expect(winterBansOffensive(axis3(), "axis", "eastern", "offensive")).toBe(true);
    expect(winterBansOffensive(axis3(null), "axis", "eastern", "offensive")).toBe(false);
  });
});

describe("whole computer games: the winter in a game the computer plays (1939 seed 3, to its end)", () => {
  const r = runGame({ scenario: "1939", seed: 3, turns: "end", verify: true });
  it("has no anomaly and the winter starts in Winter 1941", () => {
    expect(r.anomalies).toEqual([]);
    expect(r.final.winter).toMatchObject({ stage: "over", inForce: KEY });
  });
  it("in every battle fought in the winter on Axis defenders in Russia, the defence was not doubled; in every other battle on them it was; no Axis Offensive Option in the East in the winter", () => {
    let state = r.initial;
    let inWinter = 0;
    let doubledBefore = 0;
    const seen = { axis: false, allies: false };
    r.actions.forEach((a, i) => {
      if (state.phase === "player-turn" && winterInForce(state)) seen[state.activeSide] = true;
      if (a.type === "SELECT_FRONT_OPTION" && a.side === "axis" && a.front === "eastern" && a.option === "offensive") expect(winterInForce(state), `action ${i}`).toBe(false);
      const res = applyAction(r.ctx, state, a);
      if (!res.ok) throw new Error(`action ${i}: ${res.error}`);
      for (const e of res.events) {
        if (e.type !== "COMBAT_RESOLVED" || e.sweep) continue;
        const defenders = Object.values(state.units).filter((u) => u.at === e.target && !e.attackers.includes(u.id) && (u.type === "infantry" || u.type === "armor" || u.type === "airborne" || u.type === "replacement"));
        const axisInRussia = MAP.hexes[e.target]!.country === "ussr" && e.side === "allies" && defenders.some((u) => u.owner !== "finland" && ["germany", "italy", "rumania", "hungary", "bulgaria", "finland"].includes(u.owner));
        if (!axisInRussia) continue;
        const h = MAP.hexes[e.target]!;
        const plain = h.land === "plain" && state.fortresses[e.target] !== true;
        if (winterInForce(state)) {
          inWinter++;
          expect(e.multiplier === 2, `a plain-doubled Axis defence at ${e.target} in the winter (action ${i})`).toBe(false);
        } else if (plain && e.multiplier === 2) doubledBefore++;
      }
      state = res.state;
    });
    expect(inWinter).toBeGreaterThan(0);
    expect(seen).toEqual({ axis: true, allies: true });
    expect(doubledBefore).toBeGreaterThan(0); // the same kind of battle, before the winter, was doubled
  });
  it("the winter is in force in no state of any other Game Turn", () => {
    let state = r.initial;
    const keys = new Set<string>();
    for (const a of r.actions) {
      const res = applyAction(r.ctx, state, a);
      if (!res.ok) throw new Error(res.error);
      state = res.state;
      if (state.phase === "player-turn" && winterInForce(state)) keys.add(`${state.year}-${state.season}`);
    }
    expect([...keys]).toEqual([KEY]);
  });
});
