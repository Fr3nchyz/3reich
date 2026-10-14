import type { GameContext } from "./context";
import { describeStep, FIRST_STEP, LAST_STEP } from "./sequence";
import { applySetupAction, legalSetupActions } from "./setup";
import { advance, settle } from "./turn";
import { applyDeclaration, legalDeclarations } from "./war";
import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameState } from "./types";

export type { Action, ActionResult, GameEvent } from "./action-types";

/** The step a Player Turn is waiting at, or undefined when the state has no position (setup, game over, old saves). */
function waitingStep(state: GameState): string | undefined {
  const p = state.position;
  return state.phase === "player-turn" && p?.part === "player-turn" ? p.step : undefined;
}

/** All actions the active player may take now. Empty when the game is over. */
export function legalActions(ctx: GameContext, state: GameState): Action[] {
  if (state.phase === "game-over") return [];
  if (state.phase === "setup") return legalSetupActions(ctx, state);
  const step = waitingStep(state);
  if (step === undefined) return [];
  const moveOn: Action = step === LAST_STEP ? { type: "END_PLAYER_TURN", side: state.activeSide } : { type: "END_STEP", side: state.activeSide, step };
  return [...(step === FIRST_STEP ? legalDeclarations(ctx, state) : []), moveOn];
}

/** Apply one action. Pure: returns a new state, or an error if the action is illegal. */
export function applyAction(ctx: GameContext, state: GameState, action: Action): ActionResult {
  if (state.phase === "game-over") return { ok: false, error: "The game is over." };
  switch (action.type) {
    case "SETUP_PLACE":
    case "SETUP_REMOVE":
    case "SETUP_DONE": {
      if (state.phase === "player-turn") return { ok: false, error: `Setup is over; the game is at step ${describeStep(waitingStep(state) ?? "?")}.` };
      return applySetupAction(ctx, state, action);
    }
    case "END_PLAYER_TURN":
    case "END_STEP":
      return applyMoveOn(ctx, state, action);
    case "DECLARE_WAR": {
      const step = waitingStep(state);
      if (step !== FIRST_STEP) return { ok: false, error: step === undefined ? "No game turn is in progress." : `Declarations of war are made in step ${describeStep(FIRST_STEP)}; the game is at step ${describeStep(step)}.` };
      return applyDeclaration(ctx, state, action);
    }
    default:
      return { ok: false, error: `Unknown action: ${JSON.stringify(action)}` };
  }
}

/** Done with the step the game waits at (END_STEP) or with the whole Player Turn (END_PLAYER_TURN, at its last step). */
function applyMoveOn(ctx: GameContext, state: GameState, action: Extract<Action, { type: "END_PLAYER_TURN" | "END_STEP" }>): ActionResult {
  if (state.phase !== "player-turn") return { ok: false, error: "Setup is not finished yet." };
  const step = waitingStep(state);
  if (step === undefined) return { ok: false, error: "This game has no turn position (an old saved game?). Start a new game." };
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  if (action.type === "END_PLAYER_TURN" && step !== LAST_STEP) {
    return { ok: false, error: `The Player Turn ends at step ${describeStep(LAST_STEP)}; the game is at step ${describeStep(step)}.` };
  }
  if (action.type === "END_STEP" && step === LAST_STEP) {
    return { ok: false, error: `Step ${describeStep(step)} is the last of the Player Turn: end the turn instead.` };
  }
  if (action.type === "END_STEP" && action.step !== step) {
    return { ok: false, error: `Step ${describeStep(action.step)} is not the current step; the game is at step ${describeStep(step)}.` };
  }
  const left = advance(ctx, state);
  const settled = settle(ctx, left.state);
  return { ok: true, state: settled.state, events: [...left.events, ...settled.events] };
}

/** Re-apply a recorded list of actions. Throws if any action is illegal. */
export function replay(ctx: GameContext, initial: GameState, actions: readonly Action[]): { state: GameState; events: GameEvent[] } {
  let state = initial;
  const events: GameEvent[] = [];
  for (const [i, action] of actions.entries()) {
    const result = applyAction(ctx, state, action);
    if (!result.ok) throw new Error(`Action ${i} is illegal: ${result.error}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}
