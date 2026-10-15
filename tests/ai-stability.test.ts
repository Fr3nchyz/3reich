import { describe, expect, it } from "vitest";
import { idleTurns } from "../scripts/selfplay/report";
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
  it("1939, seed 1, four Game Turns", () => expect(hashOf("1939", 1, 4)).toBe(885041460));
  it("1942, seed 1, two Game Turns", () => expect(hashOf("1942", 1, 2)).toBe(3412025582));
  it("another seed plays another game", () => expect(hashOf("1939", 2, 4)).not.toBe(885041460));
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
      expect(idleTurns(r.turns).filter((x) => x.endsWith("axis")), "Axis idle Player Turns").toEqual([]);
    });
  }
});
