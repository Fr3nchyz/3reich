import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { setupProblems } from "./requirements";
import { placementProblem, placementPlaces, unitsOf, type UnitSpec } from "./placement";
import { beginPlay } from "./turn";
import type { ForceEntry, ForceOwner, GameState, Side, Unit } from "./types";

/**
 * Opening setup (Ops 4.0, 4.1, 7.0): each owner, in the scenario's order of deployment, places
 * its Force Pool on the map, then the first Player Turn begins. A placement is legal if it is in
 * the owner's territory, suits the counter (ground units on land, air units on air bases, fleets
 * in ports), respects stacking (Ref 5.0) and the scenario's setup requirements. Pressing "Done"
 * is legal once every counter is placed and every requirement is met.
 *
 * The rules live in areas.ts (where), placement.ts (may this counter go there) and
 * requirements.ts (is the setup complete); this file is the action layer on top of them.
 *
 * TODO(verify): the manual does not say whether a nation may leave Force Pool counters off the
 * map at setup; the engine requires all of them to be placed.
 * TODO(verify): Ref 29.0 forbids Germany to set up in Bessarabia in Fall 1939; its hexes are
 * not marked on the map, so German setup in Rumania is not yet limited.
 */

const AXIS_OWNERS: readonly ForceOwner[] = ["germany", "italy", "finland", "rumania", "hungary", "bulgaria", "vichy-france"];

/**
 * The side whose player sets an owner up. Italy is the Axis player's even while neutral;
 * Poland, the USSR and the USA are the Allied player's.
 */
export function sideOfOwner(owner: ForceOwner): Side {
  return AXIS_OWNERS.includes(owner) ? "axis" : "allies";
}

/** The owner now setting up, or null outside the setup phase. */
export function currentSetupOwner(state: GameState): ForceOwner | null {
  if (state.phase !== "setup" || !state.setup) return null;
  return state.setup.order[state.setup.index] ?? null;
}

// --- actions --------------------------------------------------------------------------

const poolKey = (e: Pick<ForceEntry, "type" | "strength" | "nationality">) => `${e.type}:${e.strength}:${e.nationality ?? ""}`;

/** The distinct counters in an owner's pool, in pool order. */
export function poolSpecs(state: GameState, owner: ForceOwner): (UnitSpec & { movement?: number; count: number })[] {
  const out = new Map<string, UnitSpec & { movement?: number; count: number }>();
  for (const e of state.pools[owner]?.forcePool ?? []) {
    if (e.count <= 0) continue;
    const k = poolKey(e);
    const have = out.get(k);
    if (have) have.count += e.count;
    else out.set(k, { type: e.type, strength: e.strength, ...(e.nationality ? { nationality: e.nationality } : {}), ...(e.movement !== undefined ? { movement: e.movement } : {}), count: e.count });
  }
  return [...out.values()];
}

/** Setup actions the current owner may take now. */
export function legalSetupActions(ctx: GameContext, state: GameState): Action[] {
  const owner = currentSetupOwner(state);
  if (!owner) return [];
  const actions: Action[] = [];
  for (const s of poolSpecs(state, owner)) {
    const unit = { type: s.type, strength: s.strength, ...(s.nationality ? { nationality: s.nationality } : {}) };
    for (const at of placementPlaces(ctx, state, owner, unit)) actions.push({ type: "SETUP_PLACE", owner, unit, at });
  }
  for (const u of unitsOf(state, owner)) actions.push({ type: "SETUP_REMOVE", owner, unitId: u.id });
  if (setupProblems(ctx, state, owner).length === 0) actions.push({ type: "SETUP_DONE", owner });
  return actions;
}

type SetupAction = Extract<Action, { type: "SETUP_PLACE" | "SETUP_REMOVE" | "SETUP_DONE" }>;

export function applySetupAction(ctx: GameContext, state: GameState, action: SetupAction): ActionResult {
  const owner = currentSetupOwner(state);
  if (!owner) return { ok: false, error: "The game is not in the setup phase." };
  if (action.owner !== owner) return { ok: false, error: `${owner} is setting up now, not ${action.owner}.` };

  if (action.type === "SETUP_PLACE") {
    const spec: UnitSpec = { type: action.unit.type, strength: action.unit.strength, ...(action.unit.nationality ? { nationality: action.unit.nationality } : {}) };
    const entry = (state.pools[owner]?.forcePool ?? []).find((e) => e.count > 0 && poolKey(e) === poolKey(spec));
    if (!entry) return { ok: false, error: `${owner} has no ${spec.strength}-factor ${spec.type} left to place.` };
    const problem = placementProblem(ctx, state, owner, spec, action.at);
    if (problem) return { ok: false, error: problem };
    const id = `u${state.nextUnitId}`;
    const unit: Unit = {
      id,
      owner,
      ...(spec.nationality ? { nationality: spec.nationality } : {}),
      type: spec.type,
      strength: spec.strength,
      ...(entry.movement !== undefined ? { movement: entry.movement } : {}),
      at: action.at,
    };
    const pool = state.pools[owner]!;
    const forcePool = pool.forcePool.map((e) => (e === entry ? { ...e, count: e.count - 1 } : e)).filter((e) => e.count > 0);
    return {
      ok: true,
      state: { ...state, nextUnitId: state.nextUnitId + 1, units: { ...state.units, [id]: unit }, pools: { ...state.pools, [owner]: { ...pool, forcePool } } },
      events: [{ type: "UNIT_PLACED", unitId: id, owner, at: action.at }],
    };
  }

  if (action.type === "SETUP_REMOVE") {
    const unit = state.units[action.unitId];
    if (!unit || unit.owner !== owner) return { ok: false, error: `${owner} has no unit ${action.unitId} on the map.` };
    const { [action.unitId]: _removed, ...units } = state.units;
    const pool = state.pools[owner]!;
    const back: ForceEntry = { type: unit.type, strength: unit.strength, ...(unit.movement !== undefined ? { movement: unit.movement } : {}), count: 1, ...(unit.nationality ? { nationality: unit.nationality } : {}) };
    const same = pool.forcePool.find((e) => poolKey(e) === poolKey(back) && e.movement === back.movement);
    const forcePool = same ? pool.forcePool.map((e) => (e === same ? { ...e, count: e.count + 1 } : e)) : [...pool.forcePool, back];
    return {
      ok: true,
      state: { ...state, units, pools: { ...state.pools, [owner]: { ...pool, forcePool } } },
      events: [{ type: "UNIT_REMOVED", unitId: action.unitId, owner }],
    };
  }

  // SETUP_DONE
  const problems = setupProblems(ctx, state, owner);
  if (problems.length) return { ok: false, error: `${owner} cannot finish setup: ${problems.join(" ")}` };
  const events: GameEvent[] = [{ type: "SETUP_OWNER_DONE", owner }];
  const index = state.setup!.index + 1;
  if (index < state.setup!.order.length) return { ok: true, state: { ...state, setup: { ...state.setup!, index } }, events };
  events.push({ type: "SETUP_COMPLETE" }, { type: "PLAYER_TURN_STARTED", year: state.year, season: state.season, side: state.firstSide });
  const played = beginPlay(ctx, { ...state, phase: "player-turn", setup: null, activeSide: state.firstSide });
  return { ok: true, state: played.state, events: [...events, ...played.events] };
}
