import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { createMemory } from "../src/ai/memory";
import { applyAction, legalActions } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import { newGame, turnIndex } from "../src/engine/game";
import { MAP } from "../src/data/map";
import { SCENARIOS } from "../scripts/selfplay/scenarios";
import { churnRuns, idleTurns } from "../scripts/selfplay/report";
import { runGame } from "../scripts/selfplay/runner";
import type { ScenarioKey } from "../scripts/selfplay/scenarios";

// Regression for the computer's play over a fixed seed (spec 05, "As built: idle play"). The hashes pin the recorded action lists of
// short games: THEY CHANGE ON PURPOSE whenever the computer's policy (src/ai) changes; then take the new value from the failure
// message after checking the play with `npm run selfplay` (docs/SELFPLAY.md). They guard against an accidental change, not against a change.
const fnv = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const hashOf = (scenario: ScenarioKey, seed: number, turns: number): number => fnv(JSON.stringify(runGame({ scenario, seed, turns, verify: false }).actions));

describe("fixed-seed play is stable", () => {
  it("1939, seed 1, four Game Turns", () => expect(hashOf("1939", 1, 4)).toBe(1260916810));
  it("1942, seed 1, two Game Turns", () => expect(hashOf("1942", 1, 2)).toBe(3779823303));
  it("1939, seed 5 and seed 2, four Game Turns (the Spring 1940 battle with a dozen survivors)", () => {
    expect(hashOf("1939", 5, 4)).toBe(2114108264);
    expect(hashOf("1939", 2, 4)).toBe(947755197);
  });
  it("another seed plays another game", () => expect(hashOf("1939", 2, 4)).not.toBe(1260916810));
});

// Seeds 5, 12 and 13: on the computer before the waiting at the border (git history: main at 410b830) the Axis made no move and no attack in
// Winter 1940 or Spring 1941 (every enemy objective on its land was taken, the U.S.S.R. was not yet at war); now it walks to the border.
describe("the Axis does not sit idle from Fall 1940 to Summer 1941 (1939 scenario, seeds 5, 12, 13)", () => {
  for (const seed of [5, 12, 13]) {
    it(`seed ${seed}: it moves or attacks in every one of those Player Turns, and the game ends without anomaly`, () => {
      const r = runGame({ scenario: "1939", seed, turns: "end", verify: false });
      expect(r.anomalies).toEqual([]);
      expect(r.ended).toBe("game-over");
      const stretch = r.turns.filter((t) => ["Fall 1940", "Winter 1940", "Spring 1941", "Summer 1941"].includes(t.label));
      expect(stretch).toHaveLength(4);
      for (const t of stretch) expect(t.movedBy.axis + t.attacks.axis, t.label).toBeGreaterThan(0);
      expect(idleTurns(stretch).filter((x) => x.endsWith("axis")), "Axis idle Player Turns").toEqual([]);
    });
  }
});

describe("1939 seed 5 keeps fighting (the churn regression: units scored progress toward the wrong objective and made 9 combats, not 35)", () => {
  it("makes at least 20 combats and holds at least 6 Axis objectives at the end; the Axis does not churn for three Game Turns", () => {
    const r = runGame({ scenario: "1939", seed: 5, turns: "end", verify: false });
    expect(r.turns.reduce((n, t) => n + t.combats.total, 0)).toBeGreaterThanOrEqual(20); // 25 under the armor-only ZOC of Ref 7.0 (spec 13); the churn failure this guards made 9
    expect(r.turns.at(-1)!.objectives.axis).toBeGreaterThanOrEqual(6); // 7 under the armor-only ZOC of Ref 7.0 (spec 13), 15 before; over 30 seeds the Axis holds 287 objectives against 359
    // The Axis does not churn. The Allies shuffle units for three Game Turns in this seed under the armor-only ZOC (Ref 7.0, spec 13); over 30 seeds of 1939 the runs fell from 5 to 3.
    expect(churnRuns(r.turns).filter((x) => x.startsWith("axis"))).toEqual([]);
  });
});

describe("the churn counter (self-play report)", () => {
  const turn = (label: string, moved: number, attacks: number) => ({ label, partial: false, movedBy: { axis: moved, allies: 0 }, attacks: { axis: attacks, allies: 0 } }) as unknown as Parameters<typeof churnRuns>[0][number];
  it("flags a side that moves 5 or more units without an attack in 3 Game Turns in a row, and only then", () => {
    const run = [turn("A", 9, 0), turn("B", 29, 0), turn("C", 14, 0), turn("D", 9, 3)];
    expect(churnRuns(run)).toEqual(["axis A to C (3 Game Turns, 52 units moved)"]);
    expect(churnRuns([turn("A", 9, 0), turn("B", 29, 0), turn("C", 14, 1), turn("D", 9, 0)])).toEqual([]);
    expect(churnRuns([turn("A", 9, 0), turn("B", 4, 0), turn("C", 14, 0)])).toEqual([]);
  });
});

// The lists the engine offers at step 7h (attacks, advances, losses) are what the computer chooses from; the advance list used to take
// 300-450 ms to build when a battle left a dozen survivors. A faster build must list exactly the same actions in the same order.
describe("the actions listed at step 7h are unchanged (1939, seed 5, four Game Turns)", () => {
  it("hash of every list at every 7h position along the computer's play", () => {
    const ctx = { map: MAP, scenario: SCENARIOS["1939"] };
    let state = newGame(ctx.scenario, 5);
    for (const a of autoSetup(ctx, state)) {
      const r = applyAction(ctx, state, a);
      if (r.ok) state = r.state;
    }
    const memory = createMemory();
    const end = turnIndex(state) + 4;
    let lists = 0;
    let h = 0;
    for (let n = 0; n < 5000 && state.phase === "player-turn" && turnIndex(state) < end; n++) {
      if (state.position?.part === "player-turn" && state.position.step === "7h") {
        lists++;
        h = fnv(`${h}${JSON.stringify(legalActions(ctx, state))}`);
      }
      const d = chooseAction(ctx, state, { seed: 5, memory });
      if (!d) break;
      const r = applyAction(ctx, state, d.action);
      if (!r.ok) throw new Error(r.error);
      state = r.state;
    }
    expect(lists).toBeGreaterThan(20);
    expect(h).toBe(3933492014);
  });
});
