import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { FLEETS_DISPLACED_ON_CAPTURE } from "./naval-rules";
import { displaceFleets } from "./naval-displace";
import type { GameState, Unit } from "./types";

/**
 * A hex is taken: the enemy counters that cannot defend on the ground and are left alone in it (`lonersAt`) are dealt with (spec 12 R9, spec 09 R9). The one
 * shared call of both: fleets are displaced to a friendly port (`displaceFleets`, unless `FLEETS_DISPLACED_ON_CAPTURE` is off); the counters it does not
 * handle come back in `destroy`, for the caller to eliminate as before. Spec 09 ticket 09-5 takes air units and airbases out of `destroy` here when it is built.
 */
export function afterHexTaken(ctx: GameContext, state: GameState, hex: HexId, loners: readonly Unit[]): { state: GameState; events: GameEvent[]; destroy: Unit[] } {
  const fleets = FLEETS_DISPLACED_ON_CAPTURE ? loners.filter((u) => u.type === "fleet") : [];
  const moved = displaceFleets(ctx, state, hex, fleets);
  return { ...moved, destroy: loners.filter((u) => !fleets.includes(u)) };
}
