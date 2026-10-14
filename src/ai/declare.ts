import type { Action } from "../engine/actions";
import { turnIndex } from "../engine/game";
import { combatantName, POWER_NAMES } from "../engine/nations";
import type { GameState, GameTurn, PowerId } from "../engine/types";
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
