import { isAirBase } from "./air-bases";
import { flightProblem, hexesWithin } from "./air-range";
import { frontAllowsAttack } from "./attack-rules";
import { turnKey } from "./combat-record";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import { turnIndex } from "./game";
import type { HexId } from "./hex";
import { hasMoved } from "./move-record";
import { supplyStatus } from "./supply";
import type { GameState } from "./types";
import { enemyZocFor } from "./zoc";

/** Ref 23.1: maximum outbound flight, avoiding neutral land. */
export const DROP_RANGE = 6;
/** TODO(verify) AER59: errata 31.1 permits a drop after earlier combat clears the origin ZOC. */
export const DROP_REQUIRE_START_ZOC_CLEAR = false;
/** TODO(verify) AER60: Ref 23.1 grants automatic supply next Game Turn; use ordinary supply on landing. */
export const DROP_IMMEDIATE_AUTO_SUPPLY = false;

/** Caller-owned slice: no shared state fields or action wiring. Keep the true Player Turn start snapshot. */
export interface DropRecord {
  start: GameState;
  /** Ref 23.1: retain drop Game Turn indices across Player Turns for supply and future loss handling. */
  dropped: Record<string, number>;
}

/** Ref 23.1: automatic supply lasts for the Game Turn immediately following the drop. */
export function dropSupplied(ctx: GameContext, state: GameState, record: DropRecord, id: string): boolean {
  const u = Object.hasOwn(state.units, id) ? state.units[id] : undefined;
  if (!u) return false;
  const when = record.dropped[id];
  const now = turnIndex(state);
  if (when !== undefined && (now === when + 1 || (DROP_IMMEDIATE_AUTO_SUPPLY && now === when))) return true;
  const side = sideInWar(state, u.owner);
  return side !== null && supplyStatus(ctx, state, side).supplied.some((line) => line.unitId === id);
}

/** Eligibility at normal-combat step 7g (Ref 23.1; Ops 5.46g). No exploitation drops here. */
export function dropUnitProblem(ctx: GameContext, state: GameState, record: DropRecord, id: string): string | null {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "7g") return "Airdrops require step 7g.";
  if (turnKey(record.start) !== turnKey(state)) return "The start snapshot belongs to another Player Turn.";
  const u = Object.hasOwn(state.units, id) ? state.units[id] : undefined;
  const start = Object.hasOwn(record.start.units, id) ? record.start.units[id] : undefined;
  if (!u || u.type !== "airborne") return "Only an airborne unit on the map may drop.";
  if (sideInWar(state, u.owner) !== state.activeSide) return "The airborne unit must belong to the Phasing side.";
  // Ref 23.1: present on a supplied base at turn start, and has not moved, even if it returned.
  if (!start || start.type !== "airborne" || start.owner !== u.owner || start.at !== u.at || hasMoved(state, id)) return "The airborne unit did not remain at its starting base.";
  if (!ctx.map.hexes[u.at]?.land || !isAirBase(ctx, record.start, start.at)) return "The airborne unit must begin on an airbase or city.";
  if (!dropSupplied(ctx, record.start, record, id)) return "The airborne unit began out of supply.";
  // Ref 23.1; errata 31.1 (AER59): origin ZOC now, with the provisional start test separately named.
  if (enemyZocFor(ctx, state, state.activeSide).has(u.at) ||
    (DROP_REQUIRE_START_ZOC_CLEAR && enemyZocFor(ctx, record.start, state.activeSide).has(start.at))) return "The departure base is in an enemy ZOC.";
  // Ref 23.1: no independent movement again until the next Game Turn.
  if (record.dropped[id] === turnIndex(state)) return "The airborne unit has already dropped this Game Turn.";
  return null;
}

/** Eligible counters, in id order (Ref 23.1). */
export const dropUnits = (ctx: GameContext, state: GameState, record: DropRecord): string[] =>
  Object.keys(state.units).sort().filter((id) => dropUnitProblem(ctx, state, record, id) === null);

/** Ref 23.1, 11.21, 11.41, 23.0: range, legal land and target Front; destination ZOC and stacking do not bar drops. */
export function dropProblem(ctx: GameContext, state: GameState, record: DropRecord, id: string, to: HexId): string | null {
  const problem = dropUnitProblem(ctx, state, record, id);
  if (problem) return problem;
  const target = ctx.map.hexes[to];
  if (!target?.land) return "The drop target must be a land hex on the map.";
  const u = state.units[id]!;
  if (!frontAllowsAttack(ctx, state, state.activeSide, target.front)) return "The target Front does not allow an Offensive mission.";
  return flightProblem(ctx, state, u.owner, u.at, to, DROP_RANGE);
}

/** Ref 23.1: includes enemy-occupied hexes and the origin (any hex within six); sorted deterministically. */
export function dropTargets(ctx: GameContext, state: GameState, record: DropRecord, id: string): HexId[] {
  if (dropUnitProblem(ctx, state, record, id)) return [];
  return hexesWithin(ctx, state.units[id]!.at, DROP_RANGE).filter((to) => dropProblem(ctx, state, record, id, to) === null);
}

export type DropResult = { ok: false; error: string } | {
  ok: true;
  state: GameState;
  record: DropRecord;
  supplied: boolean;
};

/**
 * Ref 23.1, 23.0: place the counter, even on enemy units or an overstack; report its supply (AER60).
 * Combat, control transfer, advance/movement restrictions and permanent losses need later integration.
 */
export function resolveDrop(ctx: GameContext, state: GameState, record: DropRecord, id: string, to: HexId): DropResult {
  const problem = dropProblem(ctx, state, record, id, to);
  if (problem) return { ok: false, error: problem };
  const next = { ...state, units: { ...state.units, [id]: { ...state.units[id]!, at: to } } };
  const updated = { ...record, dropped: { ...record.dropped, [id]: turnIndex(state) } };
  return { ok: true, state: next, record: updated, supplied: dropSupplied(ctx, next, updated, id) };
}
