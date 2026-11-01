import { attackNumbers, defendersAt } from "./attack-rules";
import type { GameContext } from "./context";
import { franceOccupied, occupiedAttackProblem } from "./france-occupied";
import type { HexId } from "./hex";
import { isUnitSupplied } from "./supply";
import type { GameState, Unit } from "./types";

/**
 * The glue between the pure queries of france-occupied.ts and the attack rules (spec 14 R5, Ref 18.3, ticket 14-9b).
 * TODO(verify) V64: an attack that includes any French unit is a French attack, so the whole stack is held to the limits;
 * set false for "only an attack made wholly by French units is limited" (then a British unit can lead a mixed stack past them).
 */
export const V64_ANY_FRENCH_UNIT_MAKES_IT_FRENCH = true;

/** Why this attack may not be made while Paris is Axis-held (reach, odds of 1:2, supply), or null. Cheap when no French unit attacks. */
export function occupiedAttackFor(ctx: GameContext, state: GameState, units: readonly Unit[], target: HexId): string | null {
  const french = units.filter((u) => u.owner === "france");
  if (french.length === 0 || (!V64_ANY_FRENCH_UNIT_MAKES_IT_FRENCH && french.length < units.length) || !franceOccupied(ctx, state)) return null;
  const defenders = defendersAt(state, units, target);
  const odds = defenders.length === 0
    ? { attack: units.reduce((n, u) => n + u.strength, 0), defense: 0 }
    : (({ attackFactors, defenseFactors, multiplier }) => ({ attack: attackFactors, defense: defenseFactors * multiplier }))(attackNumbers(ctx, state, units, defenders, target));
  return occupiedAttackProblem(ctx, state, "france", target, odds, french.every((u) => isUnitSupplied(ctx, state, u.id)));
}
