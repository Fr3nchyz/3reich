import type { GameEvent } from "./action-types";
import { applyAirLosses, type AirLossTake } from "./air-losses";
import { eliminateUnits, routeLostAirFactors } from "./losses";
import type { GameState, Unit } from "./types";

/**
 * Air factors lost on the map (spec 17 R3, RB4; spec 09 R6, R7): applies an owner's choice of air losses (`applyAirLosses`) to the units in play. A unit that
 * loses everything is destroyed whole (`eliminateUnits`, the 17-1 route, so its factors are counted once); a unit that survives is cut down to the smaller
 * counter its break-down leaves, and the factors it lost beyond that go back to the pool in the sizes of spec 09 (`routeLostAirFactors`). The air
 * combat tickets (09-x) call this where they apply air losses; nothing in play applies a partial air loss yet. Returns the problem of `applyAirLosses` when the choice is wrong.
 */
export function applyAirBreakDown(state: GameState, take: readonly AirLossTake[], owed: number): { state: GameState; events: GameEvent[] } | { problem: string } {
  const pool = take.flatMap((t) => (state.units[t.id]?.type === "air" ? [{ id: t.id, strength: state.units[t.id]!.strength }] : []));
  if (pool.length !== take.length) return { problem: "That air unit is not among those that can be lost (Ref 20.44)." };
  const done = applyAirLosses(pool, take, owed);
  if ("problem" in done) return done;
  let next = state;
  const events: GameEvent[] = [];
  const destroyed = done.applied.filter((a) => a.remaining === 0).map((a) => a.id);
  for (const a of done.applied) {
    const unit: Unit = state.units[a.id]!;
    if (a.remaining === 0 || a.lost === 0) continue;
    next = { ...next, units: { ...next.units, [a.id]: { ...unit, strength: a.remaining } } };
    const routed = routeLostAirFactors(next, unit, a.lost);
    next = routed.state;
    events.push({ type: "AIR_RESHAPED", at: unit.at, before: [{ id: unit.id, strength: unit.strength }], after: [{ id: unit.id, strength: a.remaining }] }, ...routed.events);
  }
  const gone = eliminateUnits(next, destroyed);
  return { state: gone.state, events: [...events, ...gone.events] };
}
