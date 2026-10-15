import type { Action } from "../engine/actions";
import { turnIndex } from "../engine/game";
import { BRP_COSTS } from "../engine/tables";
import { ALIGNMENT, atWar, sideOfPower } from "../engine/war";
import { combatantName, POWER_NAMES } from "../engine/nations";
import type { GameState, GameTurn, PowerId, Side } from "../engine/types";
import type { Decision } from "./types";

/**
 * Step 1, declarations of war. The computer declares war only when one of these plans says so;
 * with no plan it declares nothing, however many declarations are legal. Each is a historical
 * date the computer waits for, not a rule of the game.
 * TODO(verify): the dates are the computer's own policy, to be tuned by play-testing (spec 05).
 */
export interface DeclarationPlan {
  by: PowerId;
  on: PowerId;
  /** The Game Turn from which the declaration is made. */
  from: GameTurn;
  why: string;
}

export const DECLARATION_PLANS: readonly DeclarationPlan[] = [
  { by: "italy", on: "france", from: { year: 1940, season: "summer" }, why: "Italy joins the war once France is about to fall (historical plan: Summer 1940)." },
  { by: "italy", on: "britain", from: { year: 1940, season: "summer" }, why: "Italy joins the war once France is about to fall (historical plan: Summer 1940)." },
  { by: "germany", on: "ussr", from: { year: 1941, season: "summer" }, why: "Germany turns on the Soviet Union (historical plan: Summer 1941)." },
];

/** The first planned declaration that is legal now, or undefined: the computer declares nothing else. */
export function chooseDeclaration(state: GameState, legal: readonly Action[]): Decision | undefined {
  for (const plan of DECLARATION_PLANS) {
    if (turnIndex(state) < turnIndex(plan.from)) continue;
    const action = legal.find((a) => a.type === "DECLARE_WAR" && a.by === plan.by && a.on === plan.on);
    if (action) return { action, why: `${POWER_NAMES[plan.by]} declares on ${combatantName(plan.on)}: ${plan.why}` };
  }
  return undefined;
}

/**
 * BRPs a nation keeps back from construction so that its planned declarations stay affordable:
 * the price of every plan of its own still waiting (target not yet at war with it), while the
 * nation can declare at all (it has a side) and each declaration fits its spending limit. Without
 * this the computer spends everything on builds and no plan could ever fire.
 */
export function plannedReserve(state: GameState, by: PowerId): number {
  const me = state.nations[by];
  if (!me || sideOfPower(me) === null || BRP_COSTS.declareWarOnMajorPower > me.spendLimit) return 0;
  return DECLARATION_PLANS.filter((p) => p.by === by && !atWar(state, by, p.on)).length * BRP_COSTS.declareWarOnMajorPower;
}

/**
 * Staging (computer policy, TODO(verify): not a rule, spec 05): units with no way to an enemy objective wait at the border of a neutral
 * Major Power the side plans to declare war on. It starts STAGING_LEAD_TURNS Game Turns before the plan's date, so a unit does not
 * walk to a border long before the declaration is plausible. Set STAGING_ENABLED false to switch it off.
 */
export const STAGING_ENABLED = true;
export const STAGING_LEAD_TURNS = 2;

/** The neutral Major Powers that `side` has a declaration plan against and is within STAGING_LEAD_TURNS of making. */
export function plannedTargets(state: GameState, side: Side): PowerId[] {
  const out = new Set<PowerId>();
  if (!STAGING_ENABLED) return [];
  for (const p of DECLARATION_PLANS) {
    if (ALIGNMENT[p.by] === side && state.nations[p.on]?.status === "neutral" && turnIndex(state) >= turnIndex(p.from) - STAGING_LEAD_TURNS) out.add(p.on);
  }
  return [...out];
}
