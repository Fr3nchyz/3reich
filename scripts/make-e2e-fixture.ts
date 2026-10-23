import { writeFileSync } from "node:fs";
import { chooseAction } from "../src/ai";
import { withoutRussianRebuilds } from "../tests/helpers-surrender";
import { runGame } from "./selfplay/runner";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import type { GameState } from "../src/engine/types";
import { surrenderAsking } from "../src/engine/soviet-record";
import { surrenderShortfall } from "../src/engine/soviet-surrender";
import { MAP } from "../src/data/map";
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
/**
 * The first game of seeds 1 to 60 (starting from `from`) that reaches `stop`, cut there: [seed, actions]. `plain` plays with the computer as it is; otherwise the computer never uses a
 * Russian loss again (the view of spec 17, ticket 17-1: the returned Russian counters are left out of what it sees, so it neither builds nor takes them), which is the only way
 * Russia still wears down to the offer to surrender. Every action chosen on that view is legal on the real position.
 */
function cutAt(from: number, stop: (st: GameState) => boolean, plain = true): [number, unknown[]] {
  const choose: NonNullable<Parameters<typeof runGame>[1]>["choose"] = plain ? undefined : (ctx, st, cfg) => chooseAction(ctx, withoutRussianRebuilds(st), cfg);
  for (let seed = from; seed <= 60; seed++) {
    const r = runGame({ scenario: "1939", seed, turns: "end", verify: false }, choose ? { choose } : {});
    let state = r.initial;
    for (let i = 0; i < r.actions.length; i++) {
      const res = applyAction(r.ctx, state, r.actions[i]!);
      if (!res.ok) throw new Error(`action ${i} refused: ${res.error}`);
      state = res.state;
      if (stop(state)) return [seed, r.actions.slice(0, i + 1)];
    }
  }
  throw new Error(`no seed from ${from} to 60 reaches the situation`);
}
const [questionSeed, question] = cutAt(1, (st) => winterAsking(st));
const [startedSeed, started] = cutAt(1, (st) => st.phase === "player-turn" && winterInForce(st) && st.position?.part === "player-turn");
console.log("winter fixtures: seeds", questionSeed, "and", startedSeed, ",", question.length, "and", started.length, "actions");
writeFileSync("tests/e2e/fixtures/winter-question.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: questionSeed, actions: question }));
writeFileSync("tests/e2e/fixtures/winter-started.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: startedSeed, actions: started }));

// tests/e2e/fixtures/surrender-question.json (spec 14, ticket 14-15): a whole game of the computer (1939, seed 4, no change to the scenario) cut where Russia offers to
// surrender (Summer 1942, the end of an Allied Player Turn): the game stands at step 10a and the Axis are asked. Loaded with the `?e2e` hook for the Axis (the two
// answers are buttons) and for the Allies (the computer, playing the Axis, answers).
// Since spec 17 (ticket 17-1) no game of the plain computer reaches the offer (its Russia rebuilds its losses), so these two parts play with the computer that never uses
// a Russian loss again (`cutAt`, plain = false) and take the first seed from 1 that reaches the situation.
const [offerSeed, offer] = cutAt(1, (st) => surrenderAsking(st), false);
console.log("surrender fixture: seed", offerSeed, ",", offer.length, "actions");
writeFileSync("tests/e2e/fixtures/surrender-question.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: offerSeed, actions: offer }));

// tests/e2e/fixtures/surrender-build.json (spec 14, ticket 14-16): a whole game of the computer (1939, seed 5, no change to the scenario) cut at the first time the Allied
// Player Turn stands at step 8b with the offer to surrender on its way (Summer 1941: 13 more Russian factors would stop it). Loaded with the `?e2e` hook for the Allies, who
// read the construction warning, build a Russian unit and watch the number fall. `shortfall` is the number the warning must show at first.
const warnCtx = { map: MAP, scenario: SCENARIO_1939 };
let shortfall = 0;
const [buildSeed, build] = cutAt(1, (st) => {
  const n = st.position?.part === "player-turn" && st.position.step === "8b" && st.activeSide === "allies" ? surrenderShortfall(warnCtx, st) : null;
  if (n !== null) shortfall = n;
  return n !== null;
}, false);
console.log("surrender build fixture: seed", buildSeed, ",", build.length, "actions, shortfall", shortfall);
writeFileSync("tests/e2e/fixtures/surrender-build.json", JSON.stringify({ scenario: SCENARIO_1939.id, seed: buildSeed, shortfall, actions: build }));

// tests/e2e/fixtures/siberian-card.json (spec 14, ticket 14-18): a whole game of the computer (1942, seed 1, no change to the scenario) cut where the Allied Player Turn of
// Spring 1942 reaches step 8a with units to take: the game stands at 8a, the Allies may take three. Loaded with the `?e2e` hook for the Allies (the card) and for the
// Axis (the computer, playing the Allies, takes the units by itself).
{
  const r = runGame({ scenario: "1942", seed: 1, turns: "end", verify: false });
  let state = r.initial;
  let cut: unknown[] | null = null;
  for (let i = 0; i < r.actions.length && !cut; i++) {
    const res = applyAction(r.ctx, state, r.actions[i]!);
    if (!res.ok) throw new Error(`action ${i} refused: ${res.error}`);
    state = res.state;
    if (state.position?.part === "player-turn" && state.position.step === "8a" && state.activeSide === "allies" && legalActions(r.ctx, state).some((a) => a.type === "SIBERIAN_TRANSFER")) cut = r.actions.slice(0, i + 1);
  }
  if (!cut) throw new Error("the 1942 game never reached step 8a with units to take");
  console.log("siberian fixture:", cut.length, "actions");
  writeFileSync("tests/e2e/fixtures/siberian-card.json", JSON.stringify({ scenario: "1942", seed: 1, actions: cut }));
}
