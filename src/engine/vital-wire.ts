import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { isGone } from "./nations";
import type { GameState } from "./types";
import { payVitalAreas, VITAL_AREA_LOSS } from "./vital-areas";

/**
 * Spec 14 R8 (Ref 32.0, 34.0; TODO(verify) V27): called when control may have changed (leaving a Combat Phase, and at the end of a Game Turn).
 * Britain pays 25 BRPs once for Gibraltar and once for Suez with Alexandria; the paid flags are kept in `state.vitalPaid`.
 * Nothing happens when Britain is gone or the game is over. The deficit, if any, stays in Britain's total until the next Year Start Sequence.
 */
export function settleVitalAreas(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase === "game-over" || isGone(state.nations.britain)) return { state, events: [] };
  const paid = state.vitalPaid ?? {};
  const result = payVitalAreas(ctx, state, paid);
  if (result.due.total === 0) return { state, events: [] };
  const events: GameEvent[] = [];
  let total = state.nations.britain.brpTotal;
  const lose = (area: string, due: boolean) => {
    if (!due) return;
    total -= VITAL_AREA_LOSS;
    events.push({ type: "BRPS_CHANGED", nation: "britain", delta: -VITAL_AREA_LOSS, total, reason: `${area} is lost to the Axis (vital production area)` });
  };
  lose("Gibraltar", result.due.gibraltar);
  lose("Suez and Alexandria", result.due.suez);
  return { state: { ...result.state, vitalPaid: result.paid }, events };
}
