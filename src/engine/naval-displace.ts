import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { controllerOf, controllingSide, sideInWar } from "./control";
import type { HexId } from "./hex";
import { routeLosses } from "./losses";
import { portFronts, portsOf } from "./naval-ports";
import { seaDistances } from "./naval-routes";
import { stackingProblem } from "./placement";
import type { GameState, Unit } from "./types";

/**
 * A fleet in a port that is taken is displaced, not destroyed (spec 12 R9; Ref 21.1, 12.4, 21.43; decision D1 of spec 09): it goes at once to the closest port on its Front
 * that its side controls and that has room for it, or is eliminated if there is none. The Front of a port is the Front of the water (naval-ports.ts) and the
 * distance the shortest sea route (naval-routes.ts), so a fleet never crosses land and a Black Sea fleet never reaches the Baltic.
 *
 * TODO(verify), spec 12 part J: N15 ("closest" by sea route, not straight distance), N16 (equal distance: the lowest hex id, first slice), N17 (a fleet away on a
 * mission is not handled: none can be yet; a displaced fleet keeps its function for the Game Turn), N18 (the same rule for every capture), N36 (it happens when a
 * battle or the sweep leaves the fleet alone in its hex, the moment it used to be destroyed), N37 (a fleet in a two-Front port takes the nearest port on either of
 * its Fronts without being asked; a French fleet goes only to a French-controlled port, on its Front or, if there is none, on any Front).
 */

/** The port a fleet leaving `from` goes to, or null if it is eliminated. `state` has the other fleets where they stand now, so room is counted as it fills. */
export function displacementPort(ctx: GameContext, state: GameState, fleet: Unit, from: HexId): HexId | null {
  const side = sideInWar(state, fleet.owner);
  if (side === null) return null;
  const spec = { type: fleet.type, strength: fleet.strength, ...(fleet.nationality ? { nationality: fleet.nationality } : {}) };
  const dist = seaDistances(ctx, from);
  const fronts = portFronts(ctx, from);
  const room = portsOf(ctx).filter((p) => p !== from && dist.has(p) && stackingProblem(ctx, state, fleet.owner, spec, p) === null);
  const nearest = (ports: readonly HexId[]): HexId | null =>
    ports.reduce<HexId | null>((best, p) => (best === null || dist.get(p)! < dist.get(best)! || (dist.get(p) === dist.get(best) && p < best) ? p : best), null);
  // A French fleet may go only to a port France itself controls (an ally's port is not its own, Ref 26.0, 35.0); everyone else to any port its side controls.
  const mine = room.filter((p) => controllingSide(ctx, state, p) === side && (fleet.owner !== "france" || controllerOf(ctx, state, p) === "france"));
  const onFront = nearest(mine.filter((p) => portFronts(ctx, p).some((f) => fronts.includes(f))));
  return onFront !== null || fleet.owner !== "france" ? onFront : nearest(mine); // a French fleet with no French port on its Front goes to the nearest on any Front
}

/** These fleets, standing in `from` (a port just taken), move to their ports in unit-id order, or are eliminated; one event each. */
export function displaceFleets(ctx: GameContext, state: GameState, from: HexId, fleets: readonly Unit[]): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (const f of [...fleets].sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")) || (a.id < b.id ? -1 : 1))) {
    const to = displacementPort(ctx, current, f, from);
    events.push({ type: "FLEET_DISPLACED", unitId: f.id, owner: f.owner, from, to });
    if (to === null) {
      const { [f.id]: _gone, ...units } = current.units;
      const routed = routeLosses({ ...current, units }, [f]); // eliminated: back to the pool, or lost for good (losses.ts, spec 17 R1)
      current = routed.state;
      events.push(...routed.events);
    } else {
      current = { ...current, units: { ...current.units, [f.id]: { ...f, at: to } } };
    }
  }
  return { state: current, events };
}
