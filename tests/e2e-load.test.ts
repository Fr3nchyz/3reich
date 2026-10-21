import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { Action } from "../src/engine/actions";
import { targetsNow } from "../src/ui/attackTap";
import { installE2eLoad, sessionFromRecord, type E2eLoad } from "../src/ui/e2eLoad";

/** The recorded game the browser tests load (tests/e2e/fixtures/axis-at-7h.json, made by scripts/make-e2e-fixture.ts) must still reach step 7h with Warsaw and Krakow to attack. */
const fixture = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: Action[] };

describe("the recorded game for the browser tests (test-only hook)", () => {
  it("replays through the engine to step 7h of the first Axis Player Turn, with Warsaw and Krakow attackable", () => {
    const s = sessionFromRecord(SCENARIO_1939, "axis", fixture.seed, fixture.actions);
    expect(s.state.position).toMatchObject({ part: "player-turn", step: "7h" });
    expect(s.state.activeSide).toBe("axis");
    expect(targetsNow(s)).toEqual(["M35", "P33"]);
  });

  it("an action the rules refuse stops the load", () => {
    expect(() => sessionFromRecord(SCENARIO_1939, "axis", fixture.seed, [{ type: "END_STEP", side: "axis", step: "7h" }])).toThrow(/refused/);
  });

  it("is only listened for when the address has ?e2e", () => {
    const target = new EventTarget();
    const got: string[] = [];
    const detail: E2eLoad = { scenario: "1939", side: "axis", seed: fixture.seed, actions: fixture.actions };
    installE2eLoad(target, "", [SCENARIO_1939], () => got.push("normal"));
    target.dispatchEvent(new CustomEvent("e2e-load", { detail }));
    expect(got).toEqual([]);
    installE2eLoad(target, "?e2e", [SCENARIO_1939], () => got.push("test"));
    target.dispatchEvent(new CustomEvent("e2e-load", { detail }));
    expect(got).toEqual(["test"]);
  });
});

describe("the finished game for the browser tests (ticket 14-4)", () => {
  const ended = JSON.parse(readFileSync("tests/e2e/fixtures/ended-1939.json", "utf8")) as { scenario: string; seed: number; end: { year: number; season: "spring" | "summer" | "fall" | "winter" }; actions: Action[] };
  it("replays to the end of the scenario cut to its first Game Turn, with a result (made by scripts/make-e2e-fixture.ts)", () => {
    const got: { end: unknown; phase: string; verdict: string | undefined }[] = [];
    const target = new EventTarget();
    installE2eLoad(target, "?e2e", [SCENARIO_1939], (scenario, s) => got.push({ end: scenario.end, phase: s.state.phase, verdict: s.state.result && `${s.state.result.winner}-${s.state.result.level}` }));
    target.dispatchEvent(new CustomEvent("e2e-load", { detail: { scenario: "1939", side: "axis", seed: ended.seed, actions: ended.actions, end: ended.end } satisfies E2eLoad }));
    expect(got).toEqual([{ end: SCENARIO_1939.start, phase: "game-over", verdict: "allies-decisive" }]);
  });
});
