import { airOf, airbasesInReserve } from "./air-record";
import { AIRBASE_AT_SETUP } from "./air-rules";
import type { Action, ActionResult } from "./action-types";
import type { GameContext } from "./context";
import { controllingSide, sideInWar } from "./control";
import type { HexId } from "./hex";
import { currentSetupOwner } from "./setup";
import { supplyStatus } from "./supply";
import type { GameState, PowerId, Unit } from "./types";
import { isMajorPower } from "./war";

/**
 * Placing a movable airbase (spec 09 R2; Ref 20.1, 11.3, 11.72; Ops F6 "Place Airbase"): each Major Power has three, each set down in a
 * hex its side controls and supplies (even inside an enemy armor zone of control), one to a hex, at setup or at step 6f. A placed airbase
 * stays where it is. Whether the hex bases planes is `air-bases.ts`; this file only puts the counter down.
 */

type PlaceAirbase = Extract<Action, { type: "PLACE_AIRBASE" }>;

/** The first reason `owner` may not set an airbase down in `at` now, or null. `supplied` is the hex's supply test, skipped at setup. */
function placementProblem(ctx: GameContext, state: GameState, owner: PowerId, at: HexId, supplied: ReadonlySet<HexId> | null): string | null {
  const hex = Object.hasOwn(ctx.map.hexes, at) ? ctx.map.hexes[at] : undefined;
  if (!hex) return `${at} is not on the map.`;
  if (!hex.land) return `${at} is open water: an airbase stands on land.`;
  const side = sideInWar(state, owner);
  if (side === null) return `${owner} is not in the war, so it has no airbase to place.`;
  if (airbasesInReserve(state, owner) === 0) return `${owner} has already placed all three of its airbases.`;
  if (controllingSide(ctx, state, at) !== side) return `${at} is not held by the ${side} side: an airbase goes in a hex its side controls.`;
  if (Object.values(state.units).some((u) => u.at === at && u.type === "airbase")) return `${at} already holds an airbase: one to a hex.`;
  if (Object.values(state.units).some((u) => u.at === at && sideInWar(state, u.owner) !== side)) return `${at} holds enemy units.`;
  if (supplied && !supplied.has(at)) return `${at} is out of supply: an airbase goes in a supplied hex.`;
  return null;
}

/** The hexes of the side that a probe airbase there would be supplied in, worked out once for every candidate (a counter's own presence does not change supply). */
function suppliedHexes(ctx: GameContext, state: GameState, owner: PowerId, candidates: readonly HexId[]): Set<HexId> {
  const probes: Record<string, Unit> = {};
  candidates.forEach((at, i) => (probes[`probe${i}`] = { id: `probe${i}`, owner, type: "airbase", strength: 0, at }));
  const side = sideInWar(state, owner)!;
  const status = supplyStatus(ctx, { ...state, units: { ...state.units, ...probes } }, side);
  return new Set(status.supplied.filter((l) => l.unitId in probes).map((l) => probes[l.unitId]!.at));
}

/** Where the Major Power may set an airbase down now (setup or step 6f), in hex-id order; empty when it may not place one now. Not part of `legalActions`: it works out supply once, and the computer does not place airbases yet. */
export function airbasePlacements(ctx: GameContext, state: GameState, owner: PowerId): HexId[] {
  if (!placeableNow(state, owner)) return [];
  const inSetup = state.phase === "setup";
  const candidates = Object.keys(ctx.map.hexes).sort().filter((at) => placementProblem(ctx, state, owner, at, null) === null);
  if (inSetup || candidates.length === 0) return candidates;
  const ok = suppliedHexes(ctx, state, owner, candidates);
  return candidates.filter((at) => ok.has(at));
}

/** The first reason the owner may not place an airbase at this moment at all (wrong phase, step or side), or null. */
function momentProblem(state: GameState, owner: PowerId): string | null {
  if (!isMajorPower(owner)) return "Only a Major Power has airbases.";
  if (sideInWar(state, owner) === null) return `${owner} is not in the war, so it has no airbase to place.`;
  if (state.phase === "setup") {
    if (!AIRBASE_AT_SETUP) return "Airbases are not placed in the setup.";
    return currentSetupOwner(state) === owner ? null : `${currentSetupOwner(state) ?? "nobody"} is setting up now, not ${owner}.`;
  }
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "6f") return "Airbases are placed in the setup or at step 6f.";
  return sideInWar(state, owner) === state.activeSide ? null : `It is the ${state.activeSide} player turn.`;
}

const placeableNow = (state: GameState, owner: PowerId): boolean => momentProblem(state, owner) === null && airbasesInReserve(state, owner) > 0;

/** Sets the airbase down: a new counter of the owner, recorded as placed this Player Turn. */
export function applyPlaceAirbase(ctx: GameContext, state: GameState, action: PlaceAirbase): ActionResult {
  const { owner, at } = action;
  if (typeof owner !== "string" || typeof at !== "string") return { ok: false, error: "PLACE_AIRBASE names an owner and a hex." };
  const moment = momentProblem(state, owner);
  if (moment) return { ok: false, error: moment };
  const problem = placementProblem(ctx, state, owner, at, state.phase === "setup" ? null : suppliedHexes(ctx, state, owner, [at]));
  if (problem) return { ok: false, error: problem };
  const id = `u${state.nextUnitId}`;
  const unit: Unit = { id, owner, type: "airbase", strength: 0, at };
  const rec = airOf(state);
  return {
    ok: true,
    state: {
      ...state,
      nextUnitId: state.nextUnitId + 1,
      units: { ...state.units, [id]: unit },
      air: { ...rec, placed: [...rec.placed, id] },
      airbasesPlaced: { ...state.airbasesPlaced, [owner]: (state.airbasesPlaced?.[owner] ?? 0) + 1 },
    },
    events: [{ type: "AIRBASE_PLACED", unitId: id, owner, at }],
  };
}
