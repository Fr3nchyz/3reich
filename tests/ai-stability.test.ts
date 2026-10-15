import { describe, expect, it } from "vitest";
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
  it("1939, seed 1, four Game Turns", () => expect(hashOf("1939", 1, 4)).toBe(2511506607));
  it("1942, seed 1, two Game Turns", () => expect(hashOf("1942", 1, 2)).toBe(3946485592));
  it("another seed plays another game", () => expect(hashOf("1939", 2, 4)).not.toBe(2511506607));
});

describe("the Axis does not sit idle from Fall 1940 to Spring 1941 (1939 scenario, seeds 1 to 3)", () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: it moves or attacks in every one of those Player Turns, and the game ends without anomaly`, () => {
      const r = runGame({ scenario: "1939", seed, turns: "end", verify: false });
      expect(r.anomalies).toEqual([]);
      expect(r.ended).toBe("game-over");
      const stretch = r.turns.filter((t) => ["Fall 1940", "Winter 1940", "Spring 1941"].includes(t.label));
      expect(stretch).toHaveLength(3);
      for (const t of stretch) expect(t.movedBy.axis + t.attacks.axis, t.label).toBeGreaterThan(0);
      expect(idleTurns(stretch).filter((x) => x.endsWith("axis")), "Axis idle Player Turns").toEqual([]);
      expect(churnRuns(r.turns), "moving without attacking for three Game Turns").toEqual([]);
    });
  }
});

describe("1939 seed 5 keeps fighting (the churn regression: units scored progress toward the wrong objective and made 9 combats, not 35)", () => {
  it("makes at least 30 combats and holds at least 12 Axis objectives at the end; no side churns for three Game Turns", () => {
    const r = runGame({ scenario: "1939", seed: 5, turns: "end", verify: false });
    expect(r.turns.reduce((n, t) => n + t.combats.total, 0)).toBeGreaterThanOrEqual(30);
    expect(r.turns.at(-1)!.objectives.axis).toBeGreaterThanOrEqual(12);
    expect(churnRuns(r.turns)).toEqual([]);
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
