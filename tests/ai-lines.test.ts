import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { networkOf, suppliedAfterMove } from "../src/ai/lines";
import { createMemory } from "../src/ai/memory";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import { isUnitSupplied } from "../src/engine/supply";
import type { GameState } from "../src/engine/types";
import { MAP } from "../src/data/map";
import { SCENARIOS, type ScenarioKey } from "../scripts/selfplay/scenarios";

type Move = Extract<Action, { type: "MOVE" }>;

/** Every MOVE the engine lists at the 6f positions of a computer game (supply effects on), with the prediction and the engine's answer after the move. */
function compare(scenario: ScenarioKey, seed: number, turns: number, every: number, stride: number) {
  const ctx: GameContext = { map: MAP, scenario: SCENARIOS[scenario], supplyEffects: true };
  let state: GameState = newGame(ctx.scenario, seed);
  for (const a of autoSetup(ctx, state)) state = (applyAction(ctx, state, a) as { state: GameState }).state;
  const memory = createMemory();
  const end = turnIndex(state) + turns;
  const out = { checked: 0, cutOff: 0, wrongTrue: [] as string[], wrongFalse: [] as string[] };
  let n = 0;
  while (state.phase === "player-turn" && turnIndex(state) < end) {
    if (state.position?.part === "player-turn" && state.position.step === "6f" && n++ % every === 0) {
      const net = networkOf(ctx, state, state.activeSide);
      for (const m of legalActions(ctx, state).filter((a, i): a is Move => a.type === "MOVE" && i % stride === 0)) {
        const to = m.path[m.path.length - 1]!;
        const said = suppliedAfterMove(ctx, state, net, m.units.map((id) => state.units[id]!), to);
        const r = applyAction(ctx, state, m);
        if (!r.ok) continue;
        const truth = m.units.every((id) => isUnitSupplied(ctx, r.state, id));
        out.checked++;
        if (!truth) out.cutOff++;
        if (said && !truth) out.wrongTrue.push(`${m.units.join(",")}>${to}`);
        if (!said && truth) out.wrongFalse.push(`${m.units.join(",")}>${to}`);
      }
    }
    const d = chooseAction(ctx, state, { seed, memory });
    if (!d) break;
    const r = applyAction(ctx, state, d.action);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return out;
}

describe("suppliedAfterMove agrees with the engine's supply after the move is made", () => {
  // Seed 2 of 1939 leaves units cut off within four Game Turns, so both answers occur; the 1942 front is long and has Libya's special net.
  for (const [scenario, seed, turns, every, stride] of [["1939", 2, 4, 6, 9], ["1942", 1, 2, 12, 23]] as const) {
    it(`${scenario} seed ${seed}: a sample of the listed moves at sampled 6f positions`, () => {
      const r = compare(scenario, seed, turns, every, stride);
      expect(r.checked).toBeGreaterThan(150);
      expect(r.cutOff, "some sampled moves would leave units cut off").toBeGreaterThan(5);
      expect(r.wrongTrue, "judged supplied, but the engine says cut off").toEqual([]);
      expect(r.wrongFalse, "judged cut off, but the engine says supplied").toEqual([]);
    }, 120_000);
  }
});
