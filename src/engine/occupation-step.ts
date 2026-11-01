import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import { isGone } from "./nations";
import { applyShortfall, handBackCandidates, occupationCount } from "./occupation-force";
import { IMPLEMENTED_STEPS } from "./sequence";
import { occupationAsking, surrenderOffer } from "./soviet-record";
import type { GameState, Unit } from "./types";
import { turnKey } from "./victory";
import { RUSSIA_COUNTRY } from "./winter";

/**
 * The Occupation Force wired into the turn (spec 14 R7c, ticket 14-17; Ref 18.41, Ops 5.45h and 5.48k). The numbers and the penalty are `occupation-force.ts`.
 * On arriving at step 6h and at step 9k of an Axis Player Turn, if the Axis owes the force and it is short, Germany pays 15 BRPs and one Axis-held Russian Objective goes
 * back to Russia for good, at most once a Game Turn (`soviet.shortfallTurn`). With two or more Objectives to give back the Axis chooses (`OCCUPATION_CONCEDE`, the game
 * waits at the step); with one or none nothing is asked. While the force is short the Axis may redeploy only into Russia (`occupationSrProblem`, spec 16 AER31).
 */

/** TODO(verify) V21: the force is owed from a refusal on as well as after an acceptance (R7d says "from the refusal on"); with false only an acceptance owes it. */
export const V21_OWED_AFTER_REFUSAL = true;

/** The steps that check the force. */
export const OCCUPATION_STEPS: readonly string[] = ["6h", "9k"];

/** Whether the Axis owes an Occupation Force now: Russia's offer was answered (accepted, or refused with `V21_OWED_AFTER_REFUSAL`) and Germany is still in the game. */
export function occupationOwed(state: GameState): boolean {
  const offer = surrenderOffer(state);
  const germany = state.nations.germany;
  return (offer === "accepted" || (offer === "refused" && V21_OWED_AFTER_REFUSAL)) && germany !== undefined && !isGone(germany);
}

/** The check is due: an Axis Player Turn, the force owed and short, no penalty yet this Game Turn, and the step is built in this context. */
function checkDue(ctx: GameContext, state: GameState, step: string): boolean {
  if (state.activeSide !== "axis" || !OCCUPATION_STEPS.includes(step) || !(ctx.implementedSteps ?? IMPLEMENTED_STEPS).has(step)) return false;
  return occupationOwed(state) && !occupationCount(ctx, state).met && state.soviet?.shortfallTurn !== turnKey(state);
}

/** The penalty is paid and `hex` (or nothing, with no Objective left) goes back; the turn is marked so it is paid once. */
function pay(ctx: GameContext, state: GameState, hex: HexId | null): { state: GameState; events: GameEvent[] } {
  const done = applyShortfall(ctx, state, hex);
  const soviet = { citiesTaken: {}, ...done.state.soviet, shortfallTurn: turnKey(state), conceding: false };
  return { state: { ...done.state, soviet }, events: [{ type: "OCCUPATION_PENALTY", amount: done.penalty, hex }] };
}

/** The game arrives at step 6h or 9k (`step`): if the check is due it is made now, or the Axis is asked which Objective to hand back (`occupationAsking`). */
export function checkOccupation(ctx: GameContext, state: GameState, step: string): { state: GameState; events: GameEvent[] } {
  if (!checkDue(ctx, state, step)) return { state, events: [] };
  const c = occupationCount(ctx, state);
  const short: GameEvent = { type: "OCCUPATION_SHORT", total: c.total, ground: c.ground };
  const candidates = handBackCandidates(ctx, state);
  if (candidates.length >= 2) return { state: { ...state, soviet: { citiesTaken: {}, ...state.soviet, conceding: true } }, events: [short] };
  const paid = pay(ctx, state, candidates[0] ?? null);
  return { state: paid.state, events: [short, ...paid.events] };
}

/** The Objectives the Axis may hand back now, one action each, in hex order; empty unless the game waits for the choice. */
export function legalConcede(ctx: GameContext, state: GameState): Action[] {
  return occupationAsking(state) ? handBackCandidates(ctx, state).map((hex) => ({ type: "OCCUPATION_CONCEDE", side: "axis", hex })) : [];
}

/** The Axis names the Objective. The state returned is still at the step; `actions.ts` moves it on. */
export function applyConcede(ctx: GameContext, state: GameState, action: Extract<Action, { type: "OCCUPATION_CONCEDE" }>): ActionResult {
  if (!occupationAsking(state)) return { ok: false, error: "No Objective is waiting to be handed back." };
  if (action.side !== "axis") return { ok: false, error: `The Axis hands back the Objective, not the ${String(action.side)} side.` };
  if (!handBackCandidates(ctx, state).includes(action.hex)) return { ok: false, error: `${String(action.hex)} is not an Axis-held Russian Objective that can be handed back.` };
  const paid = pay(ctx, state, action.hex);
  return { ok: true, state: paid.state, events: paid.events };
}

/**
 * Spec 16 AER31, spec 14 R7c: while the Occupation Force is short the Axis may redeploy only to fix the shortage. Read as: a unit of the Axis side may only be
 * redeployed to a hex inside Russia (TODO(verify) V21). Null when the redeployment is allowed.
 */
export function occupationSrProblem(ctx: GameContext, state: GameState, unit: Pick<Unit, "owner">, to: HexId): string | null {
  if (!occupationOwed(state) || sideInWar(state, unit.owner) !== "axis" || occupationCount(ctx, state).met) return null;
  return ctx.map.hexes[to]?.country === RUSSIA_COUNTRY ? null : "The Occupation Force is short: the Axis may redeploy only to fix the shortage inside Russia.";
}
