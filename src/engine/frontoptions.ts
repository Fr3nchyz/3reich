import type { Action, ActionResult } from "./action-types";
import { spend, spendable } from "./brps";
import type { GameContext } from "./context";
import type { Front } from "./map";
import { BRP_COSTS } from "./tables";
import type { FrontChoice, FrontOption, GameState, PowerId } from "./types";
import { isMajorPower, sideOfPower } from "./war";
import { winterBansOffensive } from "./winter-effects";

/**
 * Front Options (Ref 11.21, step 3 of a Player Turn, spec 02). In step 3 the side to move chooses an
 * Option for each Front it wants to act on: the Offensive Option costs BRPs (BRP_COSTS.offensiveOption),
 * the Attrition and Defensive Options cost nothing. The choices are kept in `GameState.frontOptions`
 * for the rest of the Player Turn, for the combat rules to read with `frontOptionOf`.
 *
 * Settled by the text we have: three Options, the Offensive one costs 15, the Fronts are the three on
 * the map (Ref 4.4), Germany's opening Eastern Front Offensive Option is free (Ref 29.0, a scenario rule).
 * TODO(verify): which Major Power pays for an Offensive Option (any Major Power of the side with enough
 * to spend is offered); whether the cost counts towards the spending limit (taken as yes, like every
 * other BRP expense); whether a choice may be changed within step 3 (taken as no, so no refunds); what
 * a Front with no choice made means (taken as the Defensive Option: no attacks).
 */

export const FRONTS: readonly Front[] = ["western", "eastern", "mediterranean"];
export const FRONT_OPTIONS: readonly FrontOption[] = ["offensive", "attrition", "defensive"];

/** TODO(verify): the Option a Front is under when its side has made no choice. */
export const DEFAULT_FRONT_OPTION: FrontOption = "defensive";

type Select = Extract<Action, { type: "SELECT_FRONT_OPTION" }>;

/** Why the Axis cannot take the Offensive Option on the Eastern Front in the winter (Ref 28.0, spec 14 R10); the screens say the same. */
export const WINTER_BAN_TEXT = "The Russian winter is on: the Axis may not take the Offensive Option on the Eastern Front this Game Turn.";

/** The Option the side to move has on a Front this Player Turn (Ref 11.21). */
export const frontOptionOf = (state: GameState, front: Front): FrontOption => state.frontOptions[front]?.option ?? DEFAULT_FRONT_OPTION;

/** A new Player Turn begins: last turn's Options lapse. */
export const resetFrontOptions = (state: GameState): GameState => (Object.keys(state.frontOptions).length === 0 ? state : { ...state, frontOptions: {} });

/** What `option` costs the side to move on `front` now: nothing for the Attrition and Defensive Options or when the scenario makes it free. */
export function optionCost(ctx: GameContext, state: GameState, front: Front, option: FrontOption): number {
  if (option !== "offensive") return 0;
  const free = ctx.scenario.rules.some(
    (r) => r.kind === "free-front-option" && r.side === state.activeSide && r.front === front && r.option === option && r.turn.year === state.year && r.turn.season === state.season,
  );
  return free ? 0 : BRP_COSTS.offensiveOption;
}

/** Major Powers of the side to move that could pay `cost` now. */
export const payersFor = (state: GameState, cost: number): PowerId[] =>
  Object.values(state.nations).filter((n) => sideOfPower(n) === state.activeSide && spendable(n) >= cost).map((n) => n.id);

/** Whether the side to move is at war with anyone: only then does step 3 have anything to choose for. */
export const atWarNow = (state: GameState): boolean =>
  state.wars.some(([a, b]) => [a, b].some((x) => isMajorPower(x) && sideOfPower(state.nations[x]) === state.activeSide));

/** Every choice the side to move may make now: each Front without a choice yet, each Option, and for a paid one each possible payer. */
export function legalFrontOptions(ctx: GameContext, state: GameState): Action[] {
  const out: Action[] = [];
  for (const front of FRONTS) {
    if (state.frontOptions[front]) continue;
    for (const option of FRONT_OPTIONS) {
      if (winterBansOffensive(state, state.activeSide, front, option)) continue; // Ref 28.0: not offered while the Russian winter is on
      const cost = optionCost(ctx, state, front, option);
      if (cost === 0) out.push({ type: "SELECT_FRONT_OPTION", side: state.activeSide, front, option });
      else for (const payer of payersFor(state, cost)) out.push({ type: "SELECT_FRONT_OPTION", side: state.activeSide, front, option, payer });
    }
  }
  return out;
}

export function applyFrontOption(ctx: GameContext, state: GameState, action: Select): ActionResult {
  const { front, option, payer } = action;
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  if (!FRONTS.includes(front)) return { ok: false, error: `${String(front)} is not a Front.` };
  if (!FRONT_OPTIONS.includes(option)) return { ok: false, error: `${String(option)} is not a Front Option.` };
  if (state.frontOptions[front]) return { ok: false, error: `The ${front} Front already has the ${state.frontOptions[front].option} Option this turn.` };
  if (winterBansOffensive(state, state.activeSide, front, option)) return { ok: false, error: WINTER_BAN_TEXT };
  const cost = optionCost(ctx, state, front, option);
  let next = state;
  const events: Extract<ActionResult, { ok: true }>["events"] = [];
  let choice: FrontChoice = { option };
  if (cost > 0) {
    const nation = payer ? state.nations[payer] : undefined;
    if (!payer || !nation || sideOfPower(nation) !== state.activeSide) {
      return { ok: false, error: `The ${option} Option on the ${front} Front costs ${cost} BRPs: name a Major Power of the ${state.activeSide} side to pay.` };
    }
    const paid = spend(state, payer, cost, `the ${option} Option on the ${front} Front`);
    if (!paid.ok) return paid;
    next = paid.state;
    events.push(paid.event);
    choice = { option, paidBy: payer };
  }
  events.push({ type: "FRONT_OPTION_SELECTED", side: state.activeSide, front, option, cost });
  return { ok: true, state: { ...next, frontOptions: { ...next.frontOptions, [front]: choice } }, events };
}
