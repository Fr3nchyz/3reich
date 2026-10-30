import { applyAction, legalActions, type Action, type GameEvent } from "../../src/engine/actions";
import { chooseAction } from "../../src/ai";
import { createMemory } from "../../src/ai/memory";
import { autoSetup } from "../../src/engine/autosetup";
import type { GameContext } from "../../src/engine/context";
import { newGame, turnIndex } from "../../src/engine/game";
import { overstacks } from "../../src/engine/stacking";
import { SUPPLY_EFFECTS_ENABLED } from "../../src/engine/supply-effects";
import type { GameState, Scenario } from "../../src/engine/types";
import { auditConquered, auditEnd, auditRedeployed, endedWithoutResult, auditObjectives, SequenceAudit } from "./audit";
import { MAP } from "../../src/data/map";
import { auditCounters, RebuildTally } from "./rebuild";
import { SCENARIOS } from "./scenarios";
import { turnLabel, TurnTally } from "./stats";
import type { Anomaly, GameResult, RunOptions, TurnStats } from "./types";

/** The defaults of the budgets that keep a run from looping. */
export const STEP_LIMIT = 1000;
export const TURN_LIMIT = 8000;

const where = (s: GameState): string => `${turnLabel(s)}, ${s.activeSide}, ${s.position?.part === "player-turn" ? `step ${s.position.step}` : s.phase}`;
const placeOf = (s: GameState): string => `${s.year}-${s.season}-${s.activeSide}-${s.position?.part === "player-turn" ? `${s.position.turn}-${s.position.step}` : s.phase}`;
const sameAction = (a: Action, b: Action): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Things that must never be true of a state: a nation below zero BRPs, and (checked when a Player Turn has ended) a hex over its stacking limit. */
export function auditState(ctx: GameContext, state: GameState, turnEnded: boolean): { kind: "negative-brp" | "overstack"; detail: string }[] {
  const out: { kind: "negative-brp" | "overstack"; detail: string }[] = [];
  for (const n of Object.values(state.nations)) if (n.brpTotal < 0) out.push({ kind: "negative-brp", detail: `${n.id} has ${n.brpTotal} BRPs` });
  if (turnEnded) for (const o of overstacks(ctx, state)) out.push({ kind: "overstack", detail: `${o.kind} stack of ${o.unitIds.length} (${o.side}) at ${o.hex}` });
  return out;
}

/** What picks the next action: the computer, unless a test puts something else in its place to provoke an anomaly. */
export type Chooser = typeof chooseAction;

/** Replacements for tests: another chooser, or scenario data (a shortened one) in place of the named scenario. */
export interface Hooks {
  choose?: Chooser;
  scenario?: Scenario;
  /** Setup actions in place of the engine's automatic setup (to provoke a setup that does not finish). */
  setup?: (ctx: GameContext, initial: GameState) => Action[];
  /** Changes the state setup produced before play begins (to plant an overstack the engine would never allow). */
  prepare?: (state: GameState) => GameState;
}

/**
 * Plays one game with the computer on both sides, headless: the engine's automatic setup for every nation, then
 * chooseAction for whichever side is to act, applied through applyAction, until the Game Turn limit or the end of
 * the scenario. Never throws and never loops: a stuck state, a refused action, a step that does not advance or an
 * exhausted budget stops the run and is listed in `anomalies`. Deterministic for a scenario and seed (the runtime is
 * the only thing that varies).
 */
export function runGame(options: RunOptions, hooks: Hooks = {}): GameResult {
  const choose = hooks.choose ?? chooseAction;
  const memory = createMemory();
  const opt = { verify: true, stepLimit: STEP_LIMIT, turnLimit: TURN_LIMIT, ...options, supplyEffects: options.supplyEffects ?? SUPPLY_EFFECTS_ENABLED };
  const started = performance.now();
  const ctx: GameContext = { map: MAP, scenario: hooks.scenario ?? SCENARIOS[opt.scenario], supplyEffects: opt.supplyEffects };
  if (!Number.isInteger(opt.seed) || opt.seed < 0 || opt.seed > 0xffffffff) throw new RangeError(`Invalid seed ${opt.seed}: a whole number from 0 to 4294967295.`);
  const initial = newGame(ctx.scenario, opt.seed);
  const anomalies: Anomaly[] = [];
  const actions: Action[] = [];
  const turns: TurnStats[] = [];
  const seen = new Set<string>();
  const note = (kind: Anomaly["kind"], s: GameState, detail: string) => {
    const key = `${kind}|${where(s)}|${detail}`;
    if (!seen.has(key)) anomalies.push({ kind, at: where(s), detail });
    seen.add(key);
  };

  let state = initial;
  let setupActions = 0;
  /** The position play began from (after any `prepare`): RB13 counts against it, so a test that plants a counter does not trip the check. */
  let played = initial;
  try {
    for (const a of (hooks.setup ?? autoSetup)(ctx, state)) {
      const r = applyAction(ctx, state, a);
      if (!r.ok) throw new Error(`setup action ${JSON.stringify(a)} refused: ${r.error}`);
      actions.push(a);
      state = r.state;
    }
    setupActions = actions.length;
    if (hooks.prepare) state = hooks.prepare(state);
    played = state;
    if (state.phase !== "player-turn") note("setup", state, `setup finished but the game is in phase "${state.phase}", not in play`);
  } catch (e) {
    note("exception", state, `setup failed: ${(e as Error).message}`);
  }

  const stop = opt.turns === "end" ? Infinity : turnIndex(state) + opt.turns;
  const sequence = new SequenceAudit();
  const rebuild = new RebuildTally();
  let tally = new TurnTally(turnLabel(state));
  let place = "";
  let stepCount = 0;
  let turnCount = 0;
  while (state.phase === "player-turn" && turnIndex(state) < stop) {
    if (placeOf(state) !== place) { place = placeOf(state); stepCount = 0; }
    if (++stepCount > opt.stepLimit) { note("no-progress", state, `more than ${opt.stepLimit} actions at one step`); break; }
    if (++turnCount > opt.turnLimit) { note("turn-budget", state, `more than ${opt.turnLimit} actions in one Game Turn`); break; }
    let events: GameEvent[];
    let next: GameState;
    let action: Action;
    try {
      const decision = choose(ctx, state, { seed: opt.seed, memory });
      if (!decision) { note("stuck", state, "the computer has no action to take"); break; }
      action = decision.action;
      // A redeployment of one unit of a stack is accepted but not listed (sr-action.ts), and listing 9e takes 70 to 120 ms: `applyAction` below is its check.
      if (opt.verify && action.type !== "SR_UNITS" && !legalActions(ctx, state).some((l) => sameAction(l, action))) note("illegal-choice", state, `not on the legal list: ${JSON.stringify(action)}`);
      const r = applyAction(ctx, state, action);
      if (!r.ok) { note("refused", state, `${JSON.stringify(action)}: ${r.error}`); break; }
      next = r.state;
      events = r.events;
    } catch (e) {
      note("exception", state, (e as Error).message);
      break;
    }
    actions.push(action);
    tally.add(events, state, ctx);
    rebuild.add(events, state, next);
    for (const p of auditState(ctx, next, action.type === "END_PLAYER_TURN")) note(p.kind, next, p.detail);
    for (const p of auditRedeployed(ctx, events, next, state.activeSide)) note(p.kind, next, p.detail);
    for (const p of sequence.step(events, next)) note(p.kind, next, p.detail);
    const conquered = events.some((e) => e.type === "COUNTRY_CONQUERED");
    const gameTurnEnded = turnIndex(next) !== turnIndex(state) || next.phase !== "player-turn";
    if (conquered || action.type === "END_PLAYER_TURN") for (const p of auditConquered(ctx, next)) note(p.kind, next, p.detail);
    if (gameTurnEnded) for (const p of auditObjectives(ctx, next)) note(p.kind, next, p.detail);
    if (gameTurnEnded) {
      // The Game Turn ended with this action: read its closing numbers from the state the action was taken in (before the next Year Start).
      turns.push(tally.close(ctx, state, false));
      tally = new TurnTally(turnLabel(next));
      turnCount = 0;
    }
    state = next;
  }
  // The run stopped inside a Game Turn (an anomaly): report what it did so far.
  if (tally.count > 0) turns.push(tally.close(ctx, state, true));
  for (const p of [...sequence.finish(), ...auditConquered(ctx, state), ...auditObjectives(ctx, state), ...auditEnd(ctx, state), ...auditCounters(played, state)]) note(p.kind, state, p.detail);
  const ended = state.phase === "game-over" ? "game-over" : turnIndex(state) >= stop ? "turn-limit" : "stopped";
  // A game played "to the end" that did not stop on another anomaly must have ended with a result.
  if (endedWithoutResult(opt.turns, ended, anomalies.length)) note("no-result", state, `the game did not reach its end (phase "${state.phase}")`);
  return { options: opt, ctx, initial, actions, setupActions, final: state, turns, anomalies, rebuild: rebuild.result(), ended, runtimeMs: performance.now() - started };
}
