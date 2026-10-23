import type { GameEvent, LostReason } from "./action-types";
import { buildCost } from "./construction";
import { isGone } from "./nations";
import type { ForceEntry, ForceOwner, GameState, PowerId, Unit } from "./types";

/**
 * Where a lost unit goes (spec 17 R1, R4; Ref 11.6, 11.63; Ops 5.47b): back to the Force Pool of its own nation, to be built again at step 8b like any other
 * counter, or out of the game for good. Every loss of a unit in play comes here: a battle and its sweep (attack-losses.ts), ground support not used
 * (air-missions.ts), being unsupplied (supply-effects.ts), overstacking (stacking.ts), a fleet with no port to go to (naval-displace.ts), the counters
 * swept from the land a conquest passed (`sweepPassed`, conquest-forces.ts) and the British units in Vichy territory (conquest-france.ts). TODO(verify) RB1: every kind of
 * loss alike; only the list of R4 below makes a loss permanent.
 *
 * Not routed here, on purpose: the units of a country that is conquered (`removeUnits`, conquest-forces.ts) leave the game for good with their pools (V10;
 * spec 17 part B 6), and air units split or combined (air-units.ts) are not lost.
 *
 * Seams for the later tickets of spec 17: the factors an air unit loses without being destroyed (17-2, RB4) and the gray fleet (17-3, R5) read the
 * `returned` mark this module puts on the pool entry. An airborne unit destroyed before the end of the Game Turn after its drop is lost for good (Ref 23.1,
 * R4 row 3); drops are not built (ticket 09-11), so no unit is recorded as dropped yet and that row joins `lossFate` with them.
 */

/** A fleet goes back to the pool only as a whole fleet of this many factors (Ref 11.62, 21.7; TODO(verify) RB5: a partial fleet sunk is lost for good). */
export const WHOLE_FLEET_FACTORS = 9;

/**
 * Owners whose fleets are never rebuilt (Ref 11.62, docs/RULES.md: Turkey, Spain, Vichy France, Sweden and the Free French), even as active Minor-Allies.
 * Turkey, Spain and Sweden own no counters in any scenario yet (their forces are not set up, minors.ts), so only the two French owners can meet this today.
 */
export const FLEETS_NEVER_REBUILT: readonly string[] = ["turkey", "spain", "vichy-france", "sweden", "free-france"];

/** Where a lost unit goes: the pool it is added to, or the reason it is lost for good. */
export type LossFate = { pool: ForceOwner } | { lost: LostReason };

/**
 * The fate of a unit lost now (R1, R4). It goes to the pool of its own nationality (the counter's, not the Power that controls it, R1), unless:
 *  - its nation is out of the game or has no pool left (TODO(verify) RB14; a conquered Power's pools are gone, V10, so are an Italian surrender's naval factors, V16);
 *  - it is a counter that no pool holds (airbases, bridgeheads: TODO(verify) RB15);
 *  - it is a fleet of a nation whose fleets are never rebuilt, or a partial fleet (Ref 11.62; TODO(verify) RB5);
 *  - it belongs to a minor country that is not an active Minor-Ally, Poland included (Ref 14.0; TODO(verify) RB9). Vichy France, an inactive Minor-Ally, keeps
 *    its ground and air losses in its pool (TODO(verify) RB11), and the Free French theirs, for Britain to build (TODO(verify) RB10).
 */
export function lossFate(state: GameState, unit: Unit): LossFate {
  const nation: ForceOwner = unit.nationality ?? unit.owner;
  const major = Object.hasOwn(state.nations, nation) ? state.nations[nation as PowerId] : undefined;
  if (major !== undefined && isGone(major)) return { lost: "out-of-game" };
  if (major === undefined && !keepsLosses(state, nation)) return { lost: "minor-country" };
  if (buildCost(unit.type, unit.strength) === null) return { lost: "not-in-pool" };
  if (unit.type === "fleet" && FLEETS_NEVER_REBUILT.includes(nation)) return { lost: "fleet-never-rebuilt" };
  if (unit.type === "fleet" && unit.strength < WHOLE_FLEET_FACTORS) return { lost: "partial-fleet" };
  if (state.pools[nation] === undefined) return { lost: "out-of-game" };
  return { pool: nation };
}

/** A minor owner whose losses wait in its pool: an active Minor-Ally (TODO(verify) RB9), Vichy France (RB11) and the Free French (RB10). */
const keepsLosses = (state: GameState, owner: ForceOwner): boolean =>
  owner === "vichy-france" || owner === "free-france" || state.minorAllies.some((m) => m.owner === owner && m.active);

const sameCounter = (e: ForceEntry, u: Unit): boolean => e.returned === true && e.type === u.type && e.strength === u.strength && e.movement === u.movement;

/** The pool with this counter added as it was (type, factors, movement), marked returned, with no "in or after" date (TODO(verify) RB3). */
function addToPool(state: GameState, pool: ForceOwner, unit: Unit): GameState {
  const p = state.pools[pool]!;
  const at = p.allowableBuilds.findIndex((e) => sameCounter(e, unit));
  const entry: ForceEntry = { type: unit.type, strength: unit.strength, ...(unit.movement !== undefined ? { movement: unit.movement } : {}), count: 1, returned: true };
  const allowableBuilds = at < 0 ? [...p.allowableBuilds, entry] : p.allowableBuilds.map((e, i) => (i === at ? { ...e, count: e.count + 1 } : e));
  return { ...state, pools: { ...state.pools, [pool]: { ...p, allowableBuilds } } };
}

/** Sends these units, already off the map, where `lossFate` says; one event each, in the order given. */
export function routeLosses(state: GameState, lost: readonly Unit[]): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const u of lost) {
    const fate = lossFate(next, u);
    const what = { unitId: u.id, owner: u.owner, unitType: u.type, strength: u.strength, at: u.at };
    if ("pool" in fate) {
      next = addToPool(next, fate.pool, u);
      events.push({ type: "UNIT_RETURNED_TO_POOL", ...what, pool: fate.pool });
    } else {
      events.push({ type: "UNIT_LOST_FOR_GOOD", ...what, reason: fate.lost });
    }
  }
  return { state: next, events };
}

/** Takes these units off the map and routes them (`routeLosses`): one UNIT_ELIMINATED event each, with its routing event right after it. Ids not on the map are skipped. */
export function eliminateUnits(state: GameState, ids: readonly string[], reason?: "unsupplied"): { state: GameState; events: GameEvent[]; removed: Unit[] } {
  const units = { ...state.units };
  const removed: Unit[] = [];
  for (const id of ids) {
    const u = units[id];
    if (!u) continue;
    delete units[id];
    removed.push(u);
  }
  let next: GameState = { ...state, units };
  const events: GameEvent[] = [];
  for (const u of removed) {
    const routed = routeLosses(next, [u]);
    next = routed.state;
    events.push({ type: "UNIT_ELIMINATED", unitId: u.id, owner: u.owner, at: u.at, ...(reason ? { reason } : {}) }, ...routed.events);
  }
  return { state: next, events, removed };
}
