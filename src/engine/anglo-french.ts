import { conquestOf } from "./conquest-record";
import type { GameContext } from "./context";
import { controllingSide } from "./control";
import { turnIndex } from "./game";
import type { HexId } from "./hex";
import type { ForceOwner, GameState } from "./types";

/** British stop ban ends by this year (Ref 26.0, 4.8; spec 16 R32). TODO(verify): AER42, first of this date and the Allied turn after France falls. */
export const ANGLO_FRENCH_STOP_BAN_UNTIL = 1942;

/** Maginot Line, Paris, Marseilles and Vichy (Ref 26.0, 4.8; spec 16 R32). TODO(verify): AER42, the six hexes in the spec's reading. */
export const ANGLO_FRENCH_STOP_HEXES: readonly HexId[] = ["P24", "P25", "Q24", "O22", "V19", "R20"];

/** Whether the stop ban still holds; France's fall completes in an Allied Combat Phase (Ref 26.0; spec 16 R32, AER42). */
export function angloFrenchStopBanHolds(state: GameState): boolean {
  if (state.year >= ANGLO_FRENCH_STOP_BAN_UNTIL) return false;
  const fall = conquestOf(state, "france");
  if (!fall) return true;
  const turnsSinceFall = turnIndex(state) - turnIndex(fall.at);
  // The next Game Turn's Axis turn still precedes the first Allied Player Turn after the fall.
  return turnsSinceFall < 1 || (turnsSinceFall === 1 && state.activeSide === "axis");
}

/** Why this owner may not stop here, or null. Passing through is unrestricted (Ref 26.0, 4.8; spec 16 R32). */
export function angloFrenchStopProblem(ctx: GameContext, state: GameState, owner: ForceOwner, hex: HexId): string | null {
  if (owner !== "britain" || !ANGLO_FRENCH_STOP_HEXES.includes(hex) || !angloFrenchStopBanHolds(state)) return null;
  // TODO(verify): AER40, British units may enter a Maginot hex once the Axis occupies it (Ref 4.8; spec 16 R32).
  if (ctx.map.hexes[hex]?.fortress === "maginot" && controllingSide(ctx, state, hex) === "axis") return null;
  const name = ctx.map.hexes[hex]?.name ?? hex;
  return `British units may not stop in ${name} until the Allied Player Turn after France falls or ${ANGLO_FRENCH_STOP_BAN_UNTIL}.`;
}
