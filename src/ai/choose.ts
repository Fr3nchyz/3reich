import { legalActions, type Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { FIRST_STEP, LAST_STEP } from "../engine/sequence";
import type { GameState } from "../engine/types";
import { chooseAdvance, chooseAttack } from "./assault";
import { chooseBuild } from "./build";
import { chooseDeclaration } from "./declare";
import { chooseGrant } from "./grant";
import { chooseMove } from "./move";
import type { AiConfig, Decision } from "./types";

/**
 * The computer's next action for the side to move, chosen from legalActions only; null when the
 * game waits for nothing (setup, game over). A step the computer has no plan for is ended, and a
 * step is always ended once the chooser has nothing more to do, so it never loops.
 */
export function chooseAction(ctx: GameContext, state: GameState, cfg: AiConfig): Decision | null {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn") return null;
  const step = state.position.step;
  // The move list at 6f is the longest the engine builds (about 15-40 ms); it is cached per state, so asking again costs nothing.
  const legal = legalActions(ctx, state);
  if (legal.length === 0) return null;
  const picked =
    step === FIRST_STEP ? chooseDeclaration(state, legal)
    : step === "8b" ? chooseBuild(ctx, state, legal, cfg)
    : step === "9a" ? chooseGrant(state, legal, cfg)
    : step === "6f" ? chooseMove(ctx, state, legal, cfg)
    : step === "7h" ? chooseLosses(legal) ?? chooseAdvance(legal, cfg) ?? chooseAttack(ctx, state, legal, cfg)
    : undefined;
  return picked ?? endTheStep(legal, step);
}

/**
 * Ground combat (step 7h): if an Exchange waits for losses to be chosen and the computer is the one to choose (the
 * engine lists only that choice then), it takes the first legal set, as the engine lists them. Otherwise it advances
 * or attacks by assault.ts, and ends the step when neither qualifies (the fallback).
 */
function chooseLosses(legal: readonly Action[]): Decision | undefined {
  const action = legal.find((a) => a.type === "ALLOCATE_LOSSES");
  return action ? { action, why: "Loses the first legal set of units to the Exchange." } : undefined;
}

const isMoveOn = (a: Action): a is Extract<Action, { type: "END_STEP" | "END_PLAYER_TURN" }> => a.type === "END_STEP" || a.type === "END_PLAYER_TURN";

/**
 * Ending the step is the fallback for every step the computer has no chooser for, including steps
 * that gain rules later (front options, ground combat): it relies only on the engine always listing
 * the move-on action for the step the game waits at, and picks the one that names this step, so a new
 * kind of action at a step never leaves the computer stuck. If the engine ever lists none, the
 * caller gets null and stops (the browser loop does not retry from the same place).
 */
function endTheStep(legal: readonly Action[], step: string): Decision | null {
  const action = legal.find((a) => isMoveOn(a) && (a.type === "END_PLAYER_TURN" || a.step === step));
  if (!action) return null;
  const why: Record<string, string> = {
    [FIRST_STEP]: "No declaration of war is planned for now.",
    "3": "No Front Option chosen: with no combat rules yet every Front stays on the default (defensive) Option.",
    "6f": "No ground move brings a stack closer to an enemy objective.",
    "7h": "No ground attack is worth making at the odds on offer.",
    "8b": "Nothing more it wants to build within its limit and the BRPs it keeps for planned declarations.",
    "9a": "No ally is short of BRPs.",
    [LAST_STEP]: "Nothing else to do this turn.",
  };
  return { action, why: why[step] ?? "Nothing to do in this step." };
}
