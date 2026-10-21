import { writeFileSync } from "node:fs";
import { runGame } from "./selfplay/runner";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { computerAct } from "../src/ui/computerPlay";
import { newSession, computerSetup } from "../src/ui/session";
import { fillRest, finishOwner } from "../src/ui/sessionActions";
import { setupView } from "../src/ui/session";

/**
 * Writes tests/e2e/fixtures/axis-at-7h.json: the actions of a 1939 game from the first setup action to step 7h of the first Axis Player Turn, with
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
