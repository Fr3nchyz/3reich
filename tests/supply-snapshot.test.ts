import { describe, expect, it } from "vitest";
import { chooseWithoutRedeploying } from "./helpers-redeploy";
import { createMemory } from "../src/ai/memory";
import { applyAction } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import { supplyStatus } from "../src/engine/supply";
import type { GameState } from "../src/engine/types";
import { MAP } from "../src/data/map";
import { SCENARIOS, type ScenarioKey } from "../scripts/selfplay/scenarios";

// A differential snapshot of the supply search (spec 03): the hash of supplyStatus for both sides (sources, every line's path, the cut-off
// units) at every step-6f position along a computer game with the supply effects on, the computer's supply rules switched off so the
// positions do not depend on them. The values were taken with the search as it stood before supplyNetwork (git: main at 4448ddb) and match it:
// the faster search gives the same answers. They change only if the search itself or the computer's play without its supply rules changes.
// 1939 seed 2 (ticket 14-7): France now falls with Paris in this game (the computer without its supply rules takes Paris in Fall 1940, after the 80th
// of the positions), so the positions after the fall differ: 125 positions and hash 3952921572 before, 108 and 1416377456 now. Checked then: the hash of the
// first 81 positions is the same on the old and the new engine. The 1942 snapshot is unchanged.
const fnv = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
};

function snapshot(scenario: ScenarioKey, seed: number, turns: number): { positions: number; hash: number } {
  const ctx: GameContext = { map: MAP, scenario: SCENARIOS[scenario], supplyEffects: true };
  let state: GameState = newGame(ctx.scenario, seed);
  for (const a of autoSetup(ctx, state)) state = (applyAction(ctx, state, a) as { state: GameState }).state;
  const memory = createMemory();
  const end = turnIndex(state) + turns;
  let positions = 0;
  let hash = 0;
  while (state.phase === "player-turn" && turnIndex(state) < end) {
    if (state.position?.part === "player-turn" && state.position.step === "6f") {
      positions++;
      hash = fnv(`${hash}${JSON.stringify([supplyStatus(ctx, state, "axis"), supplyStatus(ctx, state, "allies")])}`);
    }
    const d = chooseWithoutRedeploying(ctx, state, { seed, memory, supplyRules: false });
    if (!d) break;
    const r = applyAction(ctx, state, d.action);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return { positions, hash };
}

// The 1942 snapshot changed on purpose in ticket 14-18: the computer takes three units in the Free Siberian Transfer in Spring 1942 (see tests/ai-stability.test.ts); with its policy off the hash is the old one.
// Both snapshots changed on purpose in ticket 17-1 (spec 17): lost units come back to the pool and the computer rebuilds them. 1939 seed 2 was 108 positions and hash
// 1416377456, 1942 seed 1 hash 872140485. Checked then on the old and the new engine: the first action to differ is a BUILD of a returned counter (1939: the 118th
// action of play, 1942: the 179th) and the first 32 positions of 1939 and 85 of 1942 are the same; the first that differs comes after that build.
describe("supplyStatus gives the same answers as before the search was made faster", () => {
  it("1939 seed 2, six Game Turns", () => expect(snapshot("1939", 2, 6)).toEqual({ positions: 114, hash: 1723459913 }), 120_000);
  it("1942 seed 1, two Game Turns", () => expect(snapshot("1942", 1, 2)).toEqual({ positions: 111, hash: 1231100402 }), 120_000);
});
