import { writeFileSync } from "node:fs";
import { runGame } from "./selfplay/runner";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import type { GameState } from "../src/engine/types";
import { winterAsking, winterInForce } from "../src/engine/winter-record";
import { computerAct } from "../src/ui/computerPlay";
import { newSession, computerSetup } from "../src/ui/session";
import { fillRest, finishOwner } from "../src/ui/sessionActions";
import { setupView } from "../src/ui/session";

/**
 * Writes tests/e2e/fixtures/axis-at-7h.json (and the other fixtures below): the actions of a 1939 game from the first setup action to step 7h of the first Axis Player Turn, with
 * attacks on offer (the computer plays the Axis moves). The browser tests load it with the `?e2e` test hook (src/ui/e2eLoad.ts) so they do not
 * click through a dozen steps to reach the fighting. Run: npx vite-node scripts/make-e2e-fixture.ts
 */
const SEED = 4;
const s = newSession(SCENARIO_1939, "allies", SEED);
s.record = [];
computerSetup(s);
for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
  fillRest(s);
  const v = setupView(s);
  if (v) finishOwner(s, v.owner);
}
const at7h = () => s.state.position?.part === "player-turn" && s.state.position.step === "7h" && s.state.activeSide === "axis";
for (let i = 0; i < 400 && !at7h(); i++) if (!computerAct(s).ok) throw new Error(s.toast);
if (!at7h()) throw new Error("did not reach 7h");
console.log("attacks on offer:", legalActions(s.ctx, s.state).filter((a) => a.type === "ATTACK").length, "actions:", s.record.length);
writeFileSync("tests/e2e/fixtures/axis-at-7h.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: SEED, actions: s.record }));

// tests/e2e/fixtures/ended-1939.json: the 1939 scenario cut to its first Game Turn (Fall 1939), played to the end by the computer on both sides, so a browser
// test can show the result card (spec 14, ticket 14-4). The test loads it with `end` set to the same Game Turn.
const cut = { ...SCENARIO_1939, end: SCENARIO_1939.start };
const ended = runGame({ scenario: "1939", seed: SEED, turns: "end" }, { scenario: cut });
if (ended.final.phase !== "game-over" || !ended.final.result) throw new Error("the short game did not end with a result");
console.log("ended game:", ended.actions.length, "actions,", ended.final.result.winner, ended.final.result.level, JSON.stringify(ended.final.result.objectives));
writeFileSync("tests/e2e/fixtures/ended-1939.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: SEED, end: SCENARIO_1939.start, actions: ended.actions }));

// tests/e2e/fixtures/winter-question.json and winter-started.json (spec 14, ticket 14-13): two whole games of the computer (1939, seeds 1 and 3, no change to the
// scenario) cut where the Russian winter shows. Seed 1: the dice leave Russia the choice, so the game stands at II.A of Winter 1941 with the Allies asked (the
// question card). Seed 3: the dice leave no choice, the winter starts at once and the game stands at the Axis' step 1 of that Game Turn (the card that tells, the
// banner, and at step 3 the greyed Offensive button). Both are loaded with the `?e2e` hook, the first for the Allies, the second for the Axis.
function cutAt(seed: number, stop: (st: GameState) => boolean): unknown[] {
  const r = runGame({ scenario: "1939", seed, turns: "end", verify: false });
  let state = r.initial;
  for (let i = 0; i < r.actions.length; i++) {
    const res = applyAction(r.ctx, state, r.actions[i]!);
    if (!res.ok) throw new Error(`action ${i} refused: ${res.error}`);
    state = res.state;
    if (stop(state)) return r.actions.slice(0, i + 1);
  }
  throw new Error(`seed ${seed}: the winter never showed`);
}
const question = cutAt(1, (st) => winterAsking(st));
const started = cutAt(3, (st) => st.phase === "player-turn" && winterInForce(st) && st.position?.part === "player-turn");
console.log("winter fixtures:", question.length, "and", started.length, "actions");
writeFileSync("tests/e2e/fixtures/winter-question.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: 1, actions: question }));
writeFileSync("tests/e2e/fixtures/winter-started.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: 3, actions: started }));
