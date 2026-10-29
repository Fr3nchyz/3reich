import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { chooseAction } from "../src/ai";
import { groundDistances } from "../src/ai/geo";
import { createMemory } from "../src/ai/memory";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { crossable, isEnemy, isGroundCombatUnit } from "../src/engine/attack-rules";
import { autoSetup } from "../src/engine/autosetup";
import { combatOf } from "../src/engine/combat-record";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import type { GameState, Scenario } from "../src/engine/types";

/**
 * A scripted HUMAN-LIKE game (feedback 2, 2026-10-14: "in later turns I could no longer attack Warsaw"): the Axis player, through
 * legalActions and applyAction only, declares war on Poland if needed, moves German stacks toward Warsaw (M35), attacks it at 7h, advances,
 * ends the turn; the computer plays the Allies as the browser does. At every 7h of every Player Turn it checks that an ATTACK is
 * offered against each hex holding an enemy counter next to an unspent German ground unit (so the step is never skipped, and no hex is
 * immune). Before the fix Warsaw kept two Polish air units after the infantry fell and was never attackable again.
 */

const WARSAW = "M35";
const GAME_TURNS = 6;
type Move = Extract<Action, { type: "MOVE" }>;
type Attack = Extract<Action, { type: "ATTACK" }>;

interface Trace {
  /** Enemy hexes next to an unspent German ground unit when the human reached (or skipped) 7h, and whether each had an ATTACK listed. */
  checks: { turn: string; hex: string; offered: boolean; at7h: boolean }[];
  warsawAttacks: string[];
  /** Spec 09 D1 / R9: planes leave for another base when Warsaw loses its infantry. */
  warsawAirDisplaced: string[];
  warsawGermanAt: string[];
  moved: number;
}

const enemyHexesInReach = (ctx: GameContext, s: GameState): string[] => {
  const spent = combatOf(s).attacked;
  const hexes = new Set<string>();
  for (const g of Object.values(s.units)) {
    if (g.owner !== "germany" || !isGroundCombatUnit(g) || spent.includes(g.id) || combatOf(s).targets.includes(g.at)) continue;
    for (const u of Object.values(s.units)) if (isEnemy(s, g.owner, u.owner) && crossable(ctx, g.at, u.at)) hexes.add(u.at);
  }
  return [...hexes].sort();
};

function playAsAxis(scenario: Scenario, seed: number): Trace {
  const ctx: GameContext = { map: MAP, scenario };
  let state = newGame(scenario, seed);
  for (const a of autoSetup(ctx, state)) {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  const memory = createMemory();
  const trace: Trace = { checks: [], warsawAttacks: [], warsawAirDisplaced: [], warsawGermanAt: [], moved: 0 };
  const apply = (a: Action) => {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
    for (const e of r.events) if (e.type === "AIR_DISPLACED" && e.from === WARSAW && e.to !== null) trace.warsawAirDisplaced.push(e.unitId);
    state = r.state;
  };
  const stop = turnIndex(state) + GAME_TURNS;
  for (let n = 0; state.phase === "player-turn" && turnIndex(state) < stop; n++) {
    if (n > 20000) throw new Error("the scripted game did not end");
    const step = state.position?.part === "player-turn" ? state.position.step : "?";
    const turn = `${state.year}-${state.season}-${state.activeSide}`;
    if (state.activeSide === "allies" || combatOf(state).pending?.chooser === "allies") {
      apply(chooseAction(ctx, state, { seed, memory })!.action);
      continue;
    }
    const legal = legalActions(ctx, state);
    const endStep = legal.find((a) => a.type === "END_STEP" || a.type === "END_PLAYER_TURN")!;
    if (step === "1") {
      apply(legal.find((a) => a.type === "DECLARE_WAR" && a.by === "germany" && a.on === "poland") ?? endStep);
    } else if (step === "6f") {
      const dist = groundDistances(ctx, state, "germany", [WARSAW]);
      let best: { score: number; move: Move } | null = null;
      for (const m of legal.filter((a): a is Move => a.type === "MOVE")) {
        const from = state.units[m.units[0]!]!;
        const d0 = dist.get(from.at);
        const d1 = dist.get(m.path[m.path.length - 1]!);
        if (from.owner !== "germany" || d0 === undefined || d1 === undefined || d1 >= d0 || d1 < 1) continue;
        const score = (d0 - d1) * 10 + m.units.length;
        if (!best || score > best.score) best = { score, move: m };
      }
      if (best) trace.moved++;
      apply(best ? best.move : endStep);
      // Leaving 6f: from here the Player Turn is at 7h, or has gone past it.
      if (!best) for (const hex of enemyHexesInReach(ctx, state)) trace.checks.push({ turn, hex, at7h: state.position?.part === "player-turn" && state.position.step === "7h", offered: legalActions(ctx, state).some((a) => a.type === "ATTACK" && a.target === hex) });
    } else if (step === "7h") {
      const pick = legal.find((a) => a.type === "ALLOCATE_LOSSES") ?? legal.find((a) => a.type === "ADVANCE") ?? legal.filter((a): a is Attack => a.type === "ATTACK" && a.target === WARSAW).sort((a, b) => b.units.length - a.units.length)[0];
      if (pick?.type === "ATTACK") trace.warsawAttacks.push(turn);
      apply(pick ?? endStep);
    } else apply(endStep);
    if (state.control[WARSAW] === "germany") trace.warsawGermanAt.push(turn);
  }
  return trace;
}

describe("a human-like Axis game: Warsaw can be attacked in every later Player Turn (feedback 2, 2026-10-14)", () => {
  for (const [name, scenario] of [["1939", SCENARIO_1939], ["campaign", SCENARIO_CAMPAIGN]] as const) {
    for (const seed of [7, 11]) {
      it(`${name}, seed ${seed}: ${GAME_TURNS} Game Turns, an ATTACK is offered on every enemy hex next to an unspent German unit, Warsaw falls`, () => {
        const t = playAsAxis(scenario, seed);
        expect(t.moved).toBeGreaterThan(0);
        expect(t.warsawAttacks.length).toBeGreaterThan(0);
        expect(t.warsawAirDisplaced.length, "spec 09 R9: Warsaw planes displace to a friendly base").toBeGreaterThan(0);
        const missed = t.checks.filter((c) => !c.offered);
        expect(missed, `hexes next to German units with no attack offered: ${JSON.stringify(missed)}`).toEqual([]);
        expect(t.warsawGermanAt.length, "Germany took Warsaw").toBeGreaterThan(0);
      }, 120_000);
    }
  }
});
