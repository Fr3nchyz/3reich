import { applyAction, type Action, type GameEvent } from "./actions";
import { legalBuilds } from "./construction";
import type { GameContext } from "./context";
import { siberianOptions } from "./siberian";
import type { GameState } from "./types";

/**
 * Spec 17 R7: a game recorded before lost units came back to the pool (ticket 17-1) still replays to its end. Its actions stay legal: a recorded BUILD
 * or Free Siberian Transfer names no `returned` mark, so it takes the scenario's counter it took then. One thing differs: the game now waits at step 8a
 * or 8b when a counter that came back could be taken or built, where the old engine passed the step, so the record goes on with an action of a later step
 * that is refused. Replaying such a record, that step is ended for it (END_STEP), as the old engine did, and the recorded action is tried again. Nothing
 * is ended when the step offers anything but returned counters, or when the action is refused for another reason: then the record does not replay.
 */

/** Whether the game waits at step 8a or 8b only because of counters that came back to the pool, or at 9e (a record made before ticket 17-1 or 16-17 passed that step). */
export function waitsOnlyForReturned(ctx: GameContext, state: GameState): "8a" | "8b" | "9e" | null {
  const p = state.position;
  if (state.phase !== "player-turn" || p?.part !== "player-turn") return null;
  // Step 9e (ticket 16-17): a record made before it waited passed the step; redeploying is optional, so the step is ended for the record. Nothing else waits there.
  if (p.step === "9e") return "9e";
  if (p.step === "8b") {
    const builds = legalBuilds(ctx, state);
    return builds.length > 0 && builds.every((a) => a.unit.returned === true) ? "8b" : null;
  }
  if (p.step === "8a") {
    const { entries } = siberianOptions(state);
    return entries.length > 0 && entries.every((e) => e.returned === true) ? "8a" : null;
  }
  return null;
}

/**
 * Replays recorded actions as `replay` does (actions.ts), ending a step that waits only for returned counters (`waitsOnlyForReturned`) when the record goes
 * on past it. `actions` are the actions as applied, the recorded ones with those END_STEP actions put in; `ended` the indexes of the recorded actions
 * before which a step was ended. Throws, naming the recorded action, when an action is refused for any other reason.
 */
export function replayRecord(ctx: GameContext, initial: GameState, recorded: readonly Action[]): { state: GameState; events: GameEvent[]; actions: Action[]; ended: number[] } {
  let state = initial;
  const events: GameEvent[] = [];
  const actions: Action[] = [];
  const ended: number[] = [];
  for (const [i, action] of recorded.entries()) {
    let result = applyAction(ctx, state, action);
    // At most three times: ending 8a can bring the game to an 8b that also waits only for returned counters, and then to 9e.
    for (let guard = 0; guard < 3 && !result.ok; guard++) {
      const step = waitsOnlyForReturned(ctx, state);
      if (step === null) break;
      const end: Action = { type: "END_STEP", side: state.activeSide, step };
      const passed = applyAction(ctx, state, end);
      if (!passed.ok) break;
      actions.push(end);
      events.push(...passed.events);
      ended.push(i);
      state = passed.state;
      result = applyAction(ctx, state, action);
    }
    if (!result.ok) throw new Error(`Action ${i} is illegal: ${result.error}`);
    actions.push(action);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events, actions, ended };
}
