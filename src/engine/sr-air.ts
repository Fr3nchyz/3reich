import { airBasesOf, airCapacity, airFactorsAt, airRoom, baseProblem } from "./air-bases";
import { flightBlocked } from "./air-range";
import { sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { srOf } from "./sr-record";
import { srHexProblem, srRegion, srView, type SrView } from "./sr-region";
import { srAllowanceProblem, srNationOf, srUnitCost } from "./sr-rules";
import type { GameState, Side, Unit } from "./types";
import { adjacentHexes } from "./zoc";

/** Ref 11.72, 20.2; spec 16 R23: successive friendly bases are at most eight hexes apart. */
export const AIR_SR_HOP = 8;
/** TODO(verify) AER32, R23: conservatively require room for the entire counter at transit bases. */
export const AIR_SR_TRANSIT_ROOM = true;
/** TODO(verify) AER32, R23: redeploy excess planes before moving their airbase; never silently eliminate them. */
export const AIR_SR_CLEAR_EXCESS_FIRST = true;
/** TODO(verify) AER32, R23: flight legs use water or legal SR land; mixed neutral coastal hexes are passable. */
export const AIR_SR_LEGAL_LAND_ONLY = true;

/** R23: a water leg avoids neutral inland hexes, but may cross the water portion of a neutral coastal hex. */
function hopReach(ctx: GameContext, state: GameState, unit: Unit, from: HexId, view: SrView): Set<HexId> {
  const reached = new Set([from]);
  const queue: [HexId, number][] = [[from, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [at, d] = queue[i]!;
    if (d >= AIR_SR_HOP) continue;
    for (const next of adjacentHexes(ctx, at)) {
      if (reached.has(next)) continue;
      const h = ctx.map.hexes[next]!;
      const neutral = flightBlocked(ctx, state, unit.owner, next) !== null;
      if (neutral ? !h.sea : h.land && AIR_SR_LEGAL_LAND_ONLY && srHexProblem(ctx, state, view, unit, next) !== null) continue;
      reached.add(next);
      queue.push([next, d + 1]);
    }
  }
  return reached;
}

/** R20, R23: combine unlimited legal land regions with successive eligible eight-hex base legs. */
function routes(ctx: GameContext, state: GameState, side: Side, unit: Unit, view: SrView): Set<HexId> {
  const reached = new Set<HexId>();
  const queue = [unit.at];
  const bases = airBasesOf(ctx, state, side).filter((h) =>
    baseProblem(ctx, state, unit, h) === null && srHexProblem(ctx, state, view, unit, h) === null &&
    (!AIR_SR_TRANSIT_ROOM || h === unit.at || airRoom(ctx, state, h) >= unit.strength));
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    const region = srRegion(ctx, state, { ...unit, at }, view);
    for (const h of region) if (!reached.has(h)) { reached.add(h); queue.push(h); }
    if (unit.type !== "air" || !bases.includes(at)) continue;
    const hop = hopReach(ctx, state, unit, at, view);
    for (const h of bases) if (hop.has(h) && !reached.has(h)) { reached.add(h); queue.push(h); }
  }
  return reached;
}

/** R18–R20, R23: pure, unwired query. Airbases use land only; no escort is selected by this API. */
export function airRedeployProblem(ctx: GameContext, state: GameState, side: Side, unit: Unit, to: HexId): string | null {
  if (unit.type !== "air" && unit.type !== "airbase") return "Choose an air unit or airbase.";
  if (side !== state.activeSide || sideInWar(state, unit.owner) !== side) return "This unit cannot redeploy for this side now.";
  if (srNationOf(state, unit) === null) return "This unit has no redeployment allowance.";
  const record = srOf(state);
  if (record.moved.includes(unit.id)) return "This unit has already redeployed this Player Turn.";
  if (unit.at === to) return "The unit is already in this hex.";
  const view = srView(ctx, state, side);
  const fault = srHexProblem(ctx, state, view, unit, unit.at) ?? srHexProblem(ctx, state, view, unit, to) ??
    srAllowanceProblem(record.used, srUnitCost(state, [unit]));
  if (fault) return fault;
  if (unit.type === "air") {
    const base = baseProblem(ctx, state, unit, to);
    if (base) return base;
    if (airRoom(ctx, state, to) < unit.strength) return "The destination has insufficient air capacity.";
  } else if (AIR_SR_CLEAR_EXCESS_FIRST) {
    // R23, Ref 20.1; AER32: removing a counter reduces capacity, including the capital cap.
    const without = { ...state, units: Object.fromEntries(Object.entries(state.units).filter(([id]) => id !== unit.id)) };
    if (airFactorsAt(state, unit.at) > airCapacity(ctx, without, unit.at)) return "Redeploy excess air factors before moving this airbase.";
  }
  return routes(ctx, state, side, unit, view).has(to) ? null : "No land route or eligible eight-hex base chain reaches this destination; airbases need an escort over water.";
}

/** R23: legal destinations in hex-id order; queries never move or eliminate counters. */
export function airRedeployReach(ctx: GameContext, state: GameState, side: Side, unit: Unit): HexId[] {
  return Object.keys(ctx.map.hexes).sort().filter((to) => airRedeployProblem(ctx, state, side, unit, to) === null);
}
