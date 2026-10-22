import type { GameContext } from "./context";
import { describeStep, FIRST_STEP, LAST_STEP } from "./sequence";
import { applySetupAction, legalSetupActions } from "./setup";
import { advance, settle } from "./turn";
import { applyChooseWinter, legalWinterActions } from "./winter";
import { winterAsking } from "./winter-record";
import { surrenderAsking } from "./soviet-record";
import { applySurrenderAnswer, legalSurrenderActions } from "./victory-actions";
import { applyAdvance, applyAttack, legalCombatActions } from "./attack";
import { applyAllocation } from "./attack-losses";
import { combatOf } from "./combat-record";
import { applyPlaceAirbase } from "./air-actions";
import { applySeaSupply, legalSeaSupply } from "./naval-actions";
import { applyDesignate, legalDesignations } from "./air-missions";
import { applyStageAir } from "./air-stage";
import { applyCombineAir, applySplitAir } from "./air-units";
import { applyMove, legalMoves } from "./move-action";
import { applyBuild, legalBuilds } from "./construction";
import { applyFrontOption, legalFrontOptions } from "./frontoptions";
import { applyGrant, legalGrants } from "./grants";
import { applyDeclaration, legalDeclarations } from "./war";
import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameState } from "./types";

export type { Action, ActionResult, GameEvent } from "./action-types";

/** Why nothing else is legal while Russia's offer to surrender waits (step 10a, spec 14 R7b). */
const SURRENDER_WAITS = "The game waits at step 10a for the Axis to answer Russia's offer to surrender.";

/** The step a Player Turn is waiting at, or undefined when the state has no position (setup, game over, old saves). */
function waitingStep(state: GameState): string | undefined {
  const p = state.position;
  return state.phase === "player-turn" && p?.part === "player-turn" ? p.step : undefined;
}

/** The actions that belong to the step the game waits at, besides moving on. */
function stepActions(ctx: GameContext, state: GameState, step: string): Action[] {
  if (step === FIRST_STEP) return legalDeclarations(ctx, state);
  if (step === "6e" || step === "9f") return legalSeaSupply(ctx, state);
  if (step === "6f") return legalMoves(ctx, state);
  if (step === "7b") return legalDesignations(ctx, state);
  if (step === "7h") return legalCombatActions(ctx, state);
  if (step === "3") return legalFrontOptions(ctx, state);
  if (step === "8b") return legalBuilds(ctx, state);
  if (step === "9a") return legalGrants(state);
  return [];
}

/**
 * Only the action that moves the game on from the step it waits at, without the step's own actions. The computer uses it at a
 * step it has no plan for, so a long list (ground moves) is not built for nothing. Empty when no step is waited at.
 */
export function moveOnAction(state: GameState): Action[] {
  const step = state.phase === "player-turn" ? waitingStep(state) : undefined;
  if (step === undefined) return [];
  return [step === LAST_STEP ? { type: "END_PLAYER_TURN", side: state.activeSide } : { type: "END_STEP", side: state.activeSide, step }];
}

/** All actions the active player may take now. Empty when the game is over. */
export function legalActions(ctx: GameContext, state: GameState): Action[] {
  if (state.phase === "game-over") return [];
  if (state.phase === "setup") return legalSetupActions(ctx, state);
  if (winterAsking(state)) return legalWinterActions(state);
  if (surrenderAsking(state)) return legalSurrenderActions(state); // step 10a: the Axis answers Russia's offer to surrender; nothing else, not even moving on, is legal
  const step = waitingStep(state);
  if (step === undefined) return [];
  const moveOn: Action = step === LAST_STEP ? { type: "END_PLAYER_TURN", side: state.activeSide } : { type: "END_STEP", side: state.activeSide, step };
  // An Exchange waiting for its losses to be chosen holds the step: nothing else, not even moving on, is legal.
  return combatOf(state).pending && step === "7h" ? stepActions(ctx, state, step) : [...stepActions(ctx, state, step), moveOn];
}

/** Apply one action. Pure: returns a new state, or an error if the action is illegal. */
export function applyAction(ctx: GameContext, state: GameState, action: Action): ActionResult {
  if (state.phase === "game-over") return { ok: false, error: "The game is over." };
  if (typeof action !== "object" || action === null) return { ok: false, error: "An action is an object with a type." };
  if (surrenderAsking(state) && action.type !== "SURRENDER_ANSWER") return { ok: false, error: SURRENDER_WAITS };
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
    case "CHOOSE_WINTER": {
      const answered = applyChooseWinter(state, action);
      if (!answered.ok) return answered;
      // The question was the only thing the game waited for at II.A: it moves on to II.B and the Player Turns.
      const left = advance(ctx, answered.state);
      const settled = settle(ctx, left.state);
      return { ok: true, state: settled.state, events: [...answered.events, ...left.events, ...settled.events] };
    }
    case "SURRENDER_ANSWER": {
      const answered = applySurrenderAnswer(ctx, state, action);
      if (!answered.ok || answered.state.phase !== "player-turn") return answered; // refused, or a conquest that decided the game ended it
      // The offer was the only thing the game waited for at 10a: it moves on to 10b.
      const left = advance(ctx, answered.state);
      const settled = settle(ctx, left.state);
      return { ok: true, state: settled.state, events: [...answered.events, ...left.events, ...settled.events] };
    }
    case "DECLARE_WAR":
      return atStep(state, FIRST_STEP, "Declarations of war are made", () => applyDeclaration(ctx, state, action));
    case "DESIGNATE_SEA_SUPPLY": {
      const at = waitingStep(state);
      if (at !== "6e" && at !== "9f") return { ok: false, error: `Fleets are named to carry supply in step 6e or 9f; the game is at step ${at ?? "none"}.` };
      // The step goes on by itself once no legal designation could save another unit (C5), as after any action that used up a step's work.
      const named = applySeaSupply(ctx, state, action);
      if (!named.ok) return named;
      const settled = settle(ctx, named.state);
      return { ok: true, state: settled.state, events: [...named.events, ...settled.events] };
    }
    case "MOVE":
      return atStep(state, "6f", "Ground units are moved", () => applyMove(ctx, state, action));
    case "PLACE_AIRBASE":
      return applyPlaceAirbase(ctx, state, action);
    case "STAGE_AIR":
      return atStep(state, "6f", "Air units are staged", () => applyStageAir(ctx, state, action));
    case "SPLIT_AIR":
      return applySplitAir(state, action);
    case "COMBINE_AIR":
      return applyCombineAir(state, action);
    case "DESIGNATE_AIR":
      return atStep(state, "7b", "Air units are committed to ground support", () => applyDesignate(ctx, state, action));
    case "ATTACK":
      return atStep(state, "7h", "Ground attacks are made", () => applyAttack(ctx, state, action));
    case "ALLOCATE_LOSSES":
      return atStep(state, "7h", "Exchange losses are chosen", () => applyAllocation(ctx, state, action));
    case "ADVANCE":
      return atStep(state, "7h", "Advances after combat are made", () => applyAdvance(ctx, state, action));
    case "SELECT_FRONT_OPTION":
      return atStep(state, "3", "Front Options are chosen", () => applyFrontOption(ctx, state, action));
    case "BUILD":
      return atStep(state, "8b", "Units are built", () => applyBuild(ctx, state, action));
    case "GRANT_BRPS":
      return atStep(state, "9a", "BRP grants are made", () => applyGrant(state, action));
    default:
      return { ok: false, error: `Unknown action: ${JSON.stringify(action)}` };
  }
}

/** Runs `apply` only if the game waits at `step`; otherwise refuses, naming the step it is at. */
function atStep(state: GameState, step: string, what: string, apply: () => ActionResult): ActionResult {
  const at = waitingStep(state);
  if (winterAsking(state)) return { ok: false, error: `${what} in step ${describeStep(step)}; the game waits at step II.A for the Allies to say whether the Russian winter waits.` };
  if (at === undefined) return { ok: false, error: "No game turn is in progress." };
  if (at !== step) return { ok: false, error: `${what} in step ${describeStep(step)}; the game is at step ${describeStep(at)}.` };
  return apply();
}

/** Done with the step the game waits at (END_STEP) or with the whole Player Turn (END_PLAYER_TURN, at its last step). */
function applyMoveOn(ctx: GameContext, state: GameState, action: Extract<Action, { type: "END_PLAYER_TURN" | "END_STEP" }>): ActionResult {
  if (state.phase !== "player-turn") return { ok: false, error: "Setup is not finished yet." };
  const step = waitingStep(state);
  if (winterAsking(state)) return { ok: false, error: "The game waits at step II.A for the Allies to say whether the Russian winter waits." };
  if (surrenderAsking(state)) return { ok: false, error: SURRENDER_WAITS };
  if (step === undefined) return { ok: false, error: "This game has no turn position (an old saved game?). Start a new game." };
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  if (action.type === "END_PLAYER_TURN" && step !== LAST_STEP) {
    return { ok: false, error: `The Player Turn ends at step ${describeStep(LAST_STEP)}; the game is at step ${describeStep(step)}.` };
  }
  if (action.type === "END_STEP" && step === LAST_STEP) {
    return { ok: false, error: `Step ${describeStep(step)} is the last of the Player Turn: end the turn instead.` };
  }
  if (step === "7h" && combatOf(state).pending) return { ok: false, error: "An Exchange in step 7h is waiting for its losses to be chosen." };
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
