import { hasCombatWork } from "./attack";
import { combatOf } from "./combat-record";
import type { GameContext } from "./context";
import { lapseBreakthroughs } from "./breakthrough";
import { hasMoveWork } from "./move-action";
import { minorHasAttacked } from "./minors-turn";
import type { GameState } from "./types";

/** Spec 15 R15: step 4 waits only while an attacked minor's unit could move (before any attack) or could attack. */
export function hasMinorTurnWork(ctx: GameContext, state: GameState): boolean {
  return (!minorHasAttacked(state) && hasMoveWork(ctx, state)) || hasCombatWork(ctx, state);
}

/**
 * Leaving step 4: the hexes attacked and the advances left open by the minors' combat are forgotten (the controller's own combat at 7h starts clean; the units that
 * attacked stay listed, they have used their turn). A state in which no minor attacked is returned unchanged.
 */
export function closeMinorTurn(state: GameState): GameState {
  const rec = combatOf(state);
  if (rec.targets.length === 0 && rec.advances.length === 0 && rec.pending === null) return state;
  return lapseBreakthroughs({ ...state, combat: { ...rec, targets: [], advances: [], pending: null } });
}
