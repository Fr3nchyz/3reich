import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replay, type Action } from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import { SCENARIOS } from "../scripts/selfplay/scenarios";
import { ctxFor } from "./helpers";

/**
 * Replays a game record saved from the browser's watch mode (set WATCH_RECORD to the file; the e2e test tests/e2e/watch.spec.ts
 * does). Skipped in a normal run.
 */
const file = process.env.WATCH_RECORD;

describe.skipIf(!file)("a game record saved by the watch mode", () => {
  it("replays with the engine's replay() and reaches the position the browser showed", () => {
    const rec = JSON.parse(readFileSync(file!, "utf8")) as { format: number; scenario: keyof typeof SCENARIOS; seed: number; setupActions: number; actions: Action[] };
    expect(rec.format).toBe(1);
    const scenario = SCENARIOS[rec.scenario];
    expect(scenario).toBeDefined();
    const done = replay(ctxFor(scenario), newGame(scenario, rec.seed), rec.actions);
    expect(done.state.phase).toBe("player-turn");
    expect(rec.actions.length).toBeGreaterThan(rec.setupActions);
  });
});
