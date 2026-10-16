import { markFlown } from "./air-record";
import type { Action, ActionResult, GameEvent } from "./action-types";
import { territoryOf, type Place } from "./areas";
import { spend, spendable } from "./brps";
import type { GameContext } from "./context";
import { hex, hexId, neighbors, ROW_COUNT } from "./hex";
import { baseSuits, stackingProblem, type UnitSpec } from "./placement";
import { turnIndex } from "./game";
import { BUILD_COST_PER_FACTOR } from "./tables";
import type { ForceEntry, GameState, PowerId, Unit, UnitType } from "./types";
import { atWar, sideOfPower } from "./war";

/**
 * Unit construction (Ref 11.6, step 8b, spec 02): a Major Power pays for one counter of its Allowable
 * Builds and places it in its home territory.
 *
 * Not built yet (TODO(verify), spec 02/03): the new unit must stand in a supplied hex that the
 * nation controlled at the start of the Game Turn and that is not in an enemy Zone of Control (Ref
 * 11.64). Supply, control and ZOC are not modelled, so a build here is allowed in any hex of the
 * nation's home territory (the countries and zones it controlled at the start of the scenario) that
 * has no enemy ground unit in it or next to it. Also not built: the "rebuilt fleet is unusable for a
 * year" rule, the home-territory exceptions (East Prussia, Ulster, Sicily; no builds in Corsica) and
 * the builds of Minor-Allies.
 */

/** The counter types that can be built, and the chart's name for each (BUILD_COST_PER_FACTOR). */
const COST_KEY: Partial<Record<UnitType, keyof typeof BUILD_COST_PER_FACTOR>> = {
  infantry: "infantry", armor: "armor", airborne: "airborne", air: "air", fleet: "naval", replacement: "replacement",
};

/** BRPs a counter costs: its factors times the price per factor (a 9-factor fleet is 27). */
export function buildCost(type: UnitType, strength: number): number | null {
  const key = COST_KEY[type];
  return key === undefined ? null : strength * BUILD_COST_PER_FACTOR[key];
}

const GROUND: readonly UnitType[] = ["infantry", "armor", "airborne"];

const firstTurn = (from: NonNullable<ForceEntry["from"]>) => ({ year: from.year, season: from.season ?? "spring" });

/** Builds the nation may still make now: its entries with some left, whose "in or after" date has come. */
export function availableBuilds(state: GameState, owner: PowerId): ForceEntry[] {
  const entries = state.pools[owner]?.allowableBuilds ?? [];
  return entries.filter((e) => e.count > 0 && buildCost(e.type, e.strength) !== null && (!e.from || turnIndex(state) >= turnIndex(firstTurn(e.from))));
}

/** Whether an enemy ground unit stands in this hex or next to it (an approximation of an enemy Zone of Control). */
function enemyNear(state: GameState, owner: PowerId, place: string): boolean {
  // Hexes beyond the top or bottom row of the board have no id and hold nothing.
  const near = new Set([place, ...neighbors(hex(place)).filter((h) => h.r >= 0 && h.r < ROW_COUNT).map(hexId)]);
  return Object.values(state.units).some((u) => near.has(u.at) && GROUND.includes(u.type) && atWar(state, owner, u.nationality ?? u.owner));
}

/** Where the nation may place this build now: the U.S. in its Box, everyone else on its home territory. */
export function buildPlaces(ctx: GameContext, state: GameState, owner: PowerId, spec: UnitSpec): Place[] {
  if (owner === "usa") return ["us-box"];
  return [...territoryOf(ctx, owner).places]
    .filter((p) => baseSuits(ctx, spec.type, p) && !stackingProblem(ctx, state, owner, spec, p) && !enemyNear(state, owner, p))
    .sort();
}

type BuildAction = Extract<Action, { type: "BUILD" }>;

/** Every build the side to move may make now (step 8b): one action per counter and place. */
export function legalBuilds(ctx: GameContext, state: GameState): BuildAction[] {
  const out: BuildAction[] = [];
  for (const owner of Object.keys(state.nations) as PowerId[]) {
    if (sideOfPower(state.nations[owner]) !== state.activeSide) continue;
    for (const e of availableBuilds(state, owner)) {
      const cost = buildCost(e.type, e.strength)!;
      if (cost > spendable(state.nations[owner])) continue;
      for (const at of buildPlaces(ctx, state, owner, e)) out.push({ type: "BUILD", owner, unit: { type: e.type, strength: e.strength }, at });
    }
  }
  return out;
}

export function applyBuild(ctx: GameContext, state: GameState, action: BuildAction): ActionResult {
  const nation = state.nations[action.owner];
  if (!nation) return { ok: false, error: `${String(action.owner)} is not a Major Power in this game.` };
  if (sideOfPower(nation) !== state.activeSide) return { ok: false, error: `${action.owner} is not on the ${state.activeSide} side, so it cannot build now.` };
  const { type, strength } = action.unit;
  const entry = availableBuilds(state, action.owner).find((e) => e.type === type && e.strength === strength);
  if (!entry) return { ok: false, error: `${action.owner} has no ${strength}-factor ${type} it may build now (none left, or not yet allowed).` };
  const cost = buildCost(type, strength)!;
  if (!buildPlaces(ctx, state, action.owner, entry).includes(action.at)) {
    return { ok: false, error: `${action.owner} may not build a ${strength}-factor ${type} at ${action.at}: it must be in its home territory, suit the counter, fit the stacking limit and have no enemy ground unit next to it.` };
  }
  const paid = spend(state, action.owner, cost, `building a ${strength}-factor ${type}`);
  if (!paid.ok) return paid;
  const id = `u${paid.state.nextUnitId}`;
  const unit: Unit = { id, owner: action.owner, type, strength, ...(entry.movement !== undefined ? { movement: entry.movement } : {}), at: action.at };
  const pool = paid.state.pools[action.owner]!;
  const allowableBuilds = pool.allowableBuilds.map((e) => (e === entry ? { ...e, count: e.count - 1 } : e)).filter((e) => e.count > 0);
  const events: GameEvent[] = [paid.event, { type: "UNIT_BUILT", unitId: id, owner: action.owner, unitType: type, strength, at: action.at, cost }];
  const built: GameState = { ...paid.state, nextUnitId: paid.state.nextUnitId + 1, units: { ...paid.state.units, [id]: unit }, pools: { ...paid.state.pools, [action.owner]: { ...pool, allowableBuilds } } };
  // Ref 20.3: an air unit built in a Game Turn flies no mission in it.
  return { ok: true, state: type === "air" ? markFlown(built, [id], "new") : built, events };
}
