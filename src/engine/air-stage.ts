import { airOf } from "./air-record";
import { citiesAt, baseProblem, nationOf } from "./air-bases";
import { flightProblem, hexesWithin } from "./air-range";
import { ONE_STAGE_PER_TURN, STAGING_RANGE } from "./air-rules";
import type { Action, ActionResult } from "./action-types";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import { endProblem } from "./movement";
import { heldAtStart } from "./naval-record";
import type { GameState, Unit } from "./types";

/**
 * Staging, also called rebasing (spec 09 R4; Ref 20.2, 11.41): in its own Movement Phase (step 6f) an air unit may change base, up to 8 hexes,
 * to a base its side held at the start of the Player Turn, over a route that avoids neutral land. Armor zones of control do not touch air,
 * staging cannot be intercepted, and an air unit stages once a Player Turn. Not built (later tickets): the Option of the Front entered
 * and the Pass Option limit (Ref 11.42), `TODO(verify)`. Whether a nation is in the war is read when the unit stages, not at the start of the turn.
 */

type StageAir = Extract<Action, { type: "STAGE_AIR" }>;

/** True for a real array of strings: a hole in a sparse array is refused (`some` and `map` skip holes). */
function allStrings(x: unknown): x is string[] {
  if (!Array.isArray(x)) return false;
  for (let i = 0; i < x.length; i++) if (typeof x[i] !== "string") return false;
  return true;
}

/** Finds the units named and the first reason they may not stage together at all (not air, not the mover's, apart, already staged), or the units. */
function stagers(state: GameState, ids: unknown): { units: Unit[] } | { error: string } {
  if (!allStrings(ids) || ids.length === 0 || new Set(ids).size !== ids.length) return { error: "Staging names one or more distinct air units." };
  if (ids.some((id) => !Object.hasOwn(state.units, id))) return { error: "A unit to stage is not on the map." };
  const units = ids.map((id) => state.units[id]!);
  const rec = airOf(state);
  for (const u of units) {
    if (u.type !== "air") return { error: `${u.id} is not an air unit: only air units stage.` };
    if (sideInWar(state, u.owner) !== state.activeSide) return { error: `${u.id} does not stage for the ${state.activeSide} side now.` };
    if (ONE_STAGE_PER_TURN && rec.staged.includes(u.id)) return { error: `${u.id} has already staged this Player Turn.` };
  }
  const apart = units.find((u) => u.at !== units[0]!.at);
  return apart ? { error: `${apart.id} at ${apart.at} is not with ${units[0]!.id} at ${units[0]!.at}: units stage together from one hex.` } : { units };
}

/** The first reason these air units, standing together, may not all stage to `to` now, or null. */
export function stageProblem(ctx: GameContext, state: GameState, units: readonly Unit[], to: HexId): string | null {
  const from = units[0]!.at;
  if (!Object.hasOwn(ctx.map.hexes, from)) return `${units[0]!.id} is not on the map.`;
  if (!Object.hasOwn(ctx.map.hexes, to)) return `${to} is not on the map.`;
  if (to === from) return `${to} is where the units already are.`;
  const side = state.activeSide;
  const rec = airOf(state);
  for (const u of units) {
    const problem = baseProblem(ctx, state, u, to) ?? flightProblem(ctx, state, u.owner, from, to, STAGING_RANGE);
    if (problem) return problem;
    // Ref 20.1: an airbase set down this Player Turn serves only air of its own nationality until the turn ends (Italian units lent to Germany count as German here).
    // A city hex that also holds the new airbase is a base in its own right, so the limit applies only to a hex that is a base because of the airbase alone (TODO(verify)).
    const placed = Object.values(state.units).find((b) => b.type === "airbase" && b.at === to && rec.placed.includes(b.id));
    if (placed && citiesAt(ctx, to) === 0 && placed.owner !== u.owner && placed.owner !== nationOf(u)) {
      return `${to} holds an airbase placed this turn: only ${placed.owner} air may use it until the turn ends.`;
    }
  }
  if (!heldAtStart(ctx, state, side, to)) return `${to} was not held by the ${side} side at the start of its turn: a base taken this turn cannot be staged to this turn.`;
  return endProblem(ctx, state, units, to);
}

/** The bases these units may stage to together now, in hex-id order (empty if the units themselves may not stage). Not part of `legalActions`: the computer does not stage yet. */
export function stagingTargets(ctx: GameContext, state: GameState, ids: readonly string[]): HexId[] {
  const found = stagers(state, ids);
  if ("error" in found) return [];
  const { units } = found;
  if (!Object.hasOwn(ctx.map.hexes, units[0]!.at)) return [];
  return hexesWithin(ctx, units[0]!.at, STAGING_RANGE).filter((hex) => stageProblem(ctx, state, units, hex) === null);
}

/** Moves the air units to the new base and records that they staged. */
export function applyStageAir(ctx: GameContext, state: GameState, action: StageAir): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${String(action.side)}.` };
  const found = stagers(state, action.units);
  if ("error" in found) return { ok: false, error: found.error };
  const { units } = found;
  if (typeof action.to !== "string") return { ok: false, error: "STAGE_AIR names a hex to stage to." };
  const problem = stageProblem(ctx, state, units, action.to);
  if (problem) return { ok: false, error: problem };
  const rec = airOf(state);
  return {
    ok: true,
    state: {
      ...state,
      units: { ...state.units, ...Object.fromEntries(units.map((u) => [u.id, { ...u, at: action.to }])) },
      air: { ...rec, staged: [...rec.staged, ...units.map((u) => u.id)] },
    },
    events: [{ type: "AIR_STAGED", units: units.map((u) => u.id), from: units[0]!.at, to: action.to }],
  };
}
