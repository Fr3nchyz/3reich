import type { GameEvent } from "./action-types";
import { displaceAir } from "./air-displace";
import { AIR_DISPLACED_ON_CAPTURE } from "./air-rules";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { FLEETS_DISPLACED_ON_CAPTURE } from "./naval-rules";
import { displaceFleets } from "./naval-displace";
import type { GameState, Unit } from "./types";

/**
 * A hex is taken: the enemy counters that cannot defend on the ground and are left alone in it (`lonersAt`) are dealt with (spec 12 R9, spec 09 R9). The one
 * shared call of both: fleets are displaced to a friendly port (`displaceFleets`, unless `FLEETS_DISPLACED_ON_CAPTURE` is off); the counters it does not
 * handle come back in `destroy`, for the caller to eliminate as before. Air and airbases follow spec 09 D1 / R9 / R2 unless AIR_DISPLACED_ON_CAPTURE is off.
 */
export function afterHexTaken(ctx: GameContext, state: GameState, hex: HexId, loners: readonly Unit[]): { state: GameState; events: GameEvent[]; destroy: Unit[] } {
  const fleets = FLEETS_DISPLACED_ON_CAPTURE ? loners.filter((u) => u.type === "fleet") : [];
  const moved = displaceFleets(ctx, state, hex, fleets);
  const air = AIR_DISPLACED_ON_CAPTURE ? loners.filter((u) => u.type === "air" || u.type === "airbase") : [];
  const displaced = displaceAir(ctx, moved.state, hex, air);
  return { state: displaced.state, events: [...moved.events, ...displaced.events], destroy: loners.filter((u) => !fleets.includes(u) && !air.includes(u)) };
}
