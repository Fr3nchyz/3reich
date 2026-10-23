import type { Action, ActionResult } from "./action-types";
import type { GameContext } from "./context";
import { defaultElimination, eliminateOverstack, overstacksOf } from "./stacking";
import type { GameState } from "./types";

/**
 * ELIMINATE_OVERSTACK (spec 16 R15, C3, C5): at step 6g (a retreat overstack, Ops 5.45g) and step 9j (the Breakthrough hex, Ops 5.48j)
 * the active side's player chooses, hex by hex, the units that go, no more than needed (`eliminationProblem` in stacking.ts). The step
 * waits only while the active side has an overstacked hex, and the game cannot move on until every one is settled.
 * TODO(verify, AER21): at 9j the player may redeploy first (spec 16 R16); until the redeployment exists the only action is this one.
 * Eliminated units go to no Force Pool yet (stacking.ts says so; the elimination routing belongs to another ticket).
 */

type Eliminate = Extract<Action, { type: "ELIMINATE_OVERSTACK" }>;

/** The steps that wait for this action. */
export const OVERSTACK_STEPS: readonly string[] = ["6g", "9j"];

/** Whether the step (6g or 9j) has work: the active side has an overstacked hex. */
export const hasOverstackWork = (ctx: GameContext, state: GameState): boolean => overstacksOf(ctx, state, state.activeSide).length > 0;

/**
 * The legal ELIMINATE_OVERSTACK actions: one, the computer's choice (`defaultElimination`). Any other choice that passes
 * `eliminationProblem` is legal too and applies; the list holds the one every player can press ("Choose for me").
 */
export function legalOverstack(ctx: GameContext, state: GameState): Action[] {
  const choices = defaultElimination(ctx, state, state.activeSide);
  return Object.keys(choices).length === 0 ? [] : [{ type: "ELIMINATE_OVERSTACK", side: state.activeSide, choices }];
}

/** Settles every overstack of the active side with the player's choice. Refused unless it names this side and settles all of them. */
export function applyEliminateOverstack(ctx: GameContext, state: GameState, action: Eliminate): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  if (typeof action.choices !== "object" || action.choices === null) return { ok: false, error: "ELIMINATE_OVERSTACK needs a choice of units for each overstacked hex." };
  if (!hasOverstackWork(ctx, state)) return { ok: false, error: "No hex of this side is overstacked." };
  return eliminateOverstack(ctx, state, action.side, action.choices);
}
