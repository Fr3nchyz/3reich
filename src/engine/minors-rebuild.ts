import type { ActionResult } from "./action-types";
import { markFlown } from "./air-record";
import { spend, spendable } from "./brps";
import { availableBuilds, buildCost } from "./construction";
import type { GameContext } from "./context";
import { hex, hexId, neighbors, ROW_COUNT } from "./hex";
import { lossFate } from "./losses";
import { AXIS_MINOR_ALLIES } from "./minors-ids";
import { markGray, markUsed } from "./naval-record";
import { baseSuits, stackingProblem } from "./placement";
import type { GameState, MinorCountry, Side, UnitType } from "./types";
import { atWar, sideOfPower } from "./war";

// TODO(verify) MC18, spec 15 R8/R9: require explicit activation; helpers alone do not activate an ally.
export const MC18_REQUIRE_ACTIVE_RECORD = true;
// TODO(verify) MC18, spec 15 R8: reuse construction's base, stacking and adjacent-enemy approximation.
export const MC18_NORMAL_BUILD_LIMITS = true;
// TODO(verify) MC19, spec 15 R6/R13: only the first helper controls Spain/Turkey's rebuilding.
export const MC19_FIRST_HELPER_REBUILDS = true;

/** Spec 15 R8/R9: a lost counter's kind and home destination; not an action or a live unit id. */
export interface MinorRebuildUnit { type: UnitType; strength: number; at: string }

function controller(state: GameState, country: MinorCountry) {
  const ally = state.minorAllies.find((m) => m.owner === country);
  if (MC18_REQUIRE_ACTIVE_RECORD && !ally?.active) return undefined;
  if (state.conquests?.some((c) => c.country === country)) return undefined;
  if ((AXIS_MINOR_ALLIES as readonly string[]).includes(country)) return ally?.of === "germany" ? ally.of : undefined;
  // Spec 15 R6: only Spain and Turkey gain Minor-Ally status through Intervention.
  if (country !== "spain" && country !== "turkey") return undefined;
  const record = state.countries?.[country];
  if (record?.status !== "allied" || !ally || !record.helpers?.includes(ally.of)) return undefined;
  if (MC19_FIRST_HELPER_REBUILDS && record.helpers[0] !== ally.of) return undefined;
  return ally.of;
}

/** Spec 15 R8, Ref 17.1/17.3: normal construction price, paid by the controlling Major Power. */
export function minorRebuildCost(_ctx: GameContext, _state: GameState, _country: MinorCountry,
  unit: MinorRebuildUnit): number | null {
  return Number.isInteger(unit.strength) && unit.strength > 0 ? buildCost(unit.type, unit.strength) : null;
}

/** Spec 15 R8/R9: active ally's returned losses only, at home, within its controller's spending limit. */
export function minorRebuildProblem(ctx: GameContext, state: GameState, side: Side,
  country: MinorCountry, unit: MinorRebuildUnit): string | null {
  const payer = controller(state, country);
  if (!payer) return "No active, unconquered Minor-Ally controller.";
  const nation = state.nations[payer];
  if (!nation || sideOfPower(nation) !== side) return "The controller is not on this side.";
  const cost = minorRebuildCost(ctx, state, country, unit);
  if (cost === null) return "Unsupported counter or strength.";
  const entry = availableBuilds(state, country).find((e) => e.returned && e.type === unit.type && e.strength === unit.strength);
  if (!entry) return "No returned counter in the minor's pool.";
  // Spec 15 R8; Ref 11.62: Spain and Turkey's fleets never return, even with a forged pool entry.
  if (!("pool" in lossFate(state, { id: "rebuild", owner: country, type: unit.type, strength: unit.strength, at: unit.at }))) return "This counter cannot be rebuilt.";
  if (cost > spendable(nation)) return "The controller cannot afford this rebuild within its spending limit.";
  const home = ctx.map.hexes[unit.at];
  if (!home?.land || home.country !== country) return "Rebuilds must be at home.";
  if (MC18_NORMAL_BUILD_LIMITS) {
    if (!baseSuits(ctx, unit.type, unit.at)) return "The destination needs a suitable base.";
    const stacking = stackingProblem(ctx, state, country, unit, unit.at);
    if (stacking) return stacking;
    const near = new Set([unit.at, ...neighbors(hex(unit.at)).filter((h) => h.r >= 0 && h.r < ROW_COUNT).map(hexId)]);
    if (Object.values(state.units).some((u) => near.has(u.at) &&
      ["infantry", "armor", "airborne"].includes(u.type) && atWar(state, payer, u.nationality ?? u.owner))) {
      return "Enemy ground units are in or adjacent to the destination.";
    }
  }
  return null;
}

/** Spec 15 R8/R9: immutable payment, one returned counter consumed and placed at home. Unwired. */
export function applyMinorRebuild(ctx: GameContext, state: GameState, side: Side,
  country: MinorCountry, unit: MinorRebuildUnit): ActionResult {
  const problem = minorRebuildProblem(ctx, state, side, country, unit);
  if (problem) return { ok: false, error: problem };
  const payer = controller(state, country)!;
  const cost = minorRebuildCost(ctx, state, country, unit)!;
  const paid = spend(state, payer, cost, `rebuilding ${country} ${unit.type}`);
  if (!paid.ok) return paid;
  const pool = state.pools[country]!;
  const entry = availableBuilds(state, country).find((e) => e.returned && e.type === unit.type && e.strength === unit.strength)!;
  const id = `u${state.nextUnitId}`;
  let next: GameState = { ...paid.state, nextUnitId: state.nextUnitId + 1,
    units: { ...state.units, [id]: { id, owner: country, type: unit.type, strength: unit.strength, at: unit.at, ...(entry.movement === undefined ? {} : { movement: entry.movement }) } },
    pools: { ...state.pools, [country]: { ...pool, allowableBuilds: pool.allowableBuilds
      .map((e) => e === entry ? { ...e, count: e.count - 1 } : e).filter((e) => e.count > 0) } } };
  // Ref 20.3/21.3, spec 15 R8: normal new-air and rebuilt-fleet restrictions.
  if (unit.type === "air") next = markFlown(next, [id], "new");
  if (unit.type === "fleet") next = markGray(markUsed(next, [id], "new"), id);
  return { ok: true, state: next, events: [paid.event, { type: "UNIT_BUILT", unitId: id, owner: payer,
    unitType: unit.type, strength: unit.strength, at: unit.at, cost, returned: true, pool: country }] };
}
