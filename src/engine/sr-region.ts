import { atWar } from "./war";
import { occupationSrProblem } from "./occupation-step";
import { controllingSide, sideInWar } from "./control";
import type { GameContext } from "./context";
import { hexsideId, parseHexId, type HexId } from "./hex";
import { endProblem } from "./movement";
import { srAllowanceProblem, srNationOf, srUnitCost, SR_UNIT_TYPES, type SrUsed } from "./sr-rules";
import { supplyNetwork, type SupplyNetwork } from "./supply";
import { supplyEffectsOn } from "./supply-effects";
import { fortressSupplies } from "./supply-sources";
import type { ForceOwner, GameState, PowerId, Side, Unit } from "./types";
import { adjacentHexes, canCross } from "./zoc";

/**
 * Strategic Redeployment by land (Ref 11.72, 4.5, 19.4, 22.0; Ops 5.48e; spec 16 R19, R20): which units may be redeployed, the region each can
 * reach, and whether a redeployment to a hex is legal. Pure queries; nothing calls them from a step yet (step 9e is ticket 16-17).
 *
 * A unit moves any distance through hexes its side controls (an ally's included) that are supplied, and may never be on, or next to, an enemy
 * unit at the start, on the way or at the end. As built:
 * - "Next to" is across a land hexside only: a hex across open water, a Crossing Arrow or an all-Qattara hexside is not next to (R20). Moving
 *   between two hexes crosses a land hexside or a Crossing Arrow (`canCross`, Ref 4.3, 4.6): the sea itself needs a Sea Escort (R22, ticket 16-21).
 * - TODO(verify) AER23: the enemy unit of the adjacency test is an enemy ground unit or Replacement (`SR_ENEMY_GROUND_TYPES`); an enemy air
 *   unit, fleet or airbase only stops a unit from entering its own hex.
 * - TODO(verify) AER44: an enemy is a counter whose side is the other side, or one that takes no side and is at war with a Major Power of this
 *   side; a future enemy not yet at war is not one. Nothing in the engine intercepts ground units, so a redeployment cannot be intercepted.
 * - TODO(verify) AER24: "supplied" is read in the unit's own supply set (`supplyNetwork`: its group's capitals, the special nets that serve it, a
 *   sea supply designation that names it) or a Fortress that would supply it there. TODO(verify) AER33: while the supply effects are off (the
 *   shipped setting) the supply test is skipped; control and enemy adjacency are always tested.
 * - TODO(verify) AER22: a unit that moved, attacked or was built this Player Turn may be redeployed; only a unit already redeployed (AER28) may not.
 * - TODO(verify) AER25: no Front restriction on land. TODO(verify) AER27: a redeployment may not end overstacked (`endProblem`, Ref 5.0, 26.0).
 * The Anglo-French stop ban (R32) reaches the end of a redeployment through `endProblem` (anglo-french.ts). Not here: Sea Escort (16-21), the
 * Occupation Force flag (AER31: built in occupation-step.ts, `occupationSrProblem`, ticket 14-17).
 */

/** Enemy counters a redeployed unit may not stand next to (Ref 11.72; R20). TODO(verify): AER23. */
export const SR_ENEMY_GROUND_TYPES: readonly Unit["type"][] = SR_UNIT_TYPES;

/** What the region search needs about a side, found once per position: reuse it for many units. */
export interface SrView {
  side: Side;
  /** The side's supply network, or null while the supply effects are off (AER33). */
  supply: SupplyNetwork | null;
  /** Hexes holding an enemy counter, or next to an enemy ground unit across a land hexside (R20, AER23, AER44). */
  blocked: ReadonlySet<HexId>;
  /** Regions found so far, by supply key and then by hex (every hex of a region maps to the same set). */
  regions: Map<string, Map<HexId, ReadonlySet<HexId>>>;
}

/** Whether an owner's counters are this side's enemies now (AER44). */
function enemyOf(state: GameState, side: Side, owner: ForceOwner): boolean {
  const theirs = sideInWar(state, owner);
  if (theirs !== null) return theirs !== side;
  return (Object.keys(state.nations) as PowerId[]).some((p) => sideInWar(state, p) === side && atWar(state, p, owner));
}

/** The hexes next to this one across a land hexside (not open water, not a Crossing Arrow, not the Qattara Depression): R20's "next to". */
function landNeighbours(ctx: GameContext, hex: HexId): HexId[] {
  const a = parseHexId(hex);
  if (!a) return [];
  return adjacentHexes(ctx, hex).filter((n) => {
    const b = parseHexId(n);
    return !!b && ctx.map.hexsides[hexsideId(a, b)]?.land === true;
  });
}

/** The side's view of the board for redeployment: its enemies' hexes and their neighbours, and its supply network while the effects are on. */
export function srView(ctx: GameContext, state: GameState, side: Side = state.activeSide): SrView {
  const blocked = new Set<HexId>();
  for (const u of Object.values(state.units)) {
    if (!ctx.map.hexes[u.at] || !enemyOf(state, side, u.owner)) continue;
    blocked.add(u.at);
    if (SR_ENEMY_GROUND_TYPES.includes(u.type)) for (const n of landNeighbours(ctx, u.at)) blocked.add(n);
  }
  return { side, supply: supplyEffectsOn(ctx) ? supplyNetwork(ctx, state, side) : null, blocked, regions: new Map() };
}

/** Whether a hex is supplied for this unit (AER24), or true while the supply test is skipped (AER33). */
function suppliedAt(ctx: GameContext, state: GameState, view: SrView, unit: Unit, hex: HexId): boolean {
  if (view.supply === null) return true;
  const serves = (r: SupplyNetwork["reaches"][number]) => (r.kind === "sea" ? r.units?.has(unit.id) === true : r.serves(unit.owner));
  return view.supply.reaches.some((r) => serves(r) && r.next.has(hex)) || fortressSupplies(ctx, state, view.side, { at: hex, owner: unit.owner });
}

type HexFault = "land" | "control" | "enemy" | "supply";

/** What is wrong with a hex for a redeployed unit (R20), or null: land its side controls, no enemy on or next to it, supplied. */
function hexFault(ctx: GameContext, state: GameState, view: SrView, unit: Unit, hex: HexId): HexFault | null {
  if (!ctx.map.hexes[hex]?.land) return "land";
  if (controllingSide(ctx, state, hex) !== view.side) return "control";
  if (view.blocked.has(hex)) return "enemy";
  return suppliedAt(ctx, state, view, unit, hex) ? null : "supply";
}

/** Why a redeployed unit may not be in this hex (at the start, on the way or at the end), or null (R20). */
export function srHexProblem(ctx: GameContext, state: GameState, view: SrView, unit: Unit, hex: HexId): string | null {
  const fault = hexFault(ctx, state, view, unit, hex);
  if (fault === "land") return `${hex} is not a land hex.`;
  if (fault === "control") return `${hex} is not controlled by the ${view.side} side.`;
  if (fault === "enemy") return `${hex} is on or next to an enemy unit.`;
  if (fault === "supply") return `${hex} is cut off from supply for ${unit.id}.`;
  return null;
}

/** The key of the hexes a unit's region may use: its side's, and its own supply set while the supply test applies. */
function regionKey(view: SrView, unit: Unit): string {
  if (view.supply === null) return "all";
  const named = view.supply.reaches.some((r) => r.kind === "sea" && r.units?.has(unit.id));
  return named ? `${unit.owner}|sea:${unit.id}` : unit.owner;
}

/**
 * The connected region a unit can be redeployed within (R20): every hex reachable from its own hex through hexes that pass `srHexProblem`,
 * step by step across a land hexside or a Crossing Arrow, any distance. Its own hex is in it; empty when its own hex does not pass.
 * Stacking at the end is not looked at here (`srProblem` does).
 */
export function srRegion(ctx: GameContext, state: GameState, unit: Unit, view: SrView = srView(ctx, state, sideInWar(state, unit.owner) ?? state.activeSide)): ReadonlySet<HexId> {
  const key = regionKey(view, unit);
  let byHex = view.regions.get(key);
  if (!byHex) view.regions.set(key, (byHex = new Map<HexId, ReadonlySet<HexId>>()));
  const hit = byHex.get(unit.at);
  if (hit) return hit;
  const region = new Set<HexId>();
  if (hexFault(ctx, state, view, unit, unit.at) !== null) return region;
  const frontier = [unit.at];
  region.add(unit.at);
  while (frontier.length) {
    const here = frontier.pop()!;
    for (const n of adjacentHexes(ctx, here)) {
      if (region.has(n) || !canCross(ctx, here, n) || hexFault(ctx, state, view, unit, n) !== null) continue;
      region.add(n);
      frontier.push(n);
    }
  }
  for (const h of region) byHex.set(h, region);
  return region;
}

/**
 * Why this unit cannot be redeployed now, wherever it would go, or null (R19): a ground unit or Replacement of the side to move, on a map hex,
 * of a nation with an allowance, not redeployed already this Player Turn (`redeployed`, AER28), and its own hex passes `srHexProblem`.
 */
export function srUnitProblem(ctx: GameContext, state: GameState, unit: Unit, redeployed: readonly string[] = [], view?: SrView): string | null {
  if (!SR_UNIT_TYPES.includes(unit.type)) return `${unit.id} is not a ground unit or a Replacement: only those are redeployed now.`;
  if (!ctx.map.hexes[unit.at]) return `${unit.id} is not on the map.`;
  if (sideInWar(state, unit.owner) !== state.activeSide) return `${unit.id} does not redeploy for the ${state.activeSide} side now.`;
  if (srNationOf(state, unit) === null) return `${unit.id} cannot be redeployed in this version.`;
  if (redeployed.includes(unit.id)) return `${unit.id} has already been redeployed this Player Turn.`;
  const fault = hexFault(ctx, state, view ?? srView(ctx, state), unit, unit.at);
  if (fault === "enemy") return `${unit.id} is next to an enemy unit.`;
  if (fault === "supply") return `${unit.id} is cut off from supply.`;
  return fault === null ? null : `${unit.id} stands on ${unit.at}, which is not land its side controls.`;
}

/** What `srProblem` reads besides the board: the allowances used and the units already redeployed this Player Turn (ticket 16-17's record). */
export interface SrSoFar {
  used?: SrUsed;
  redeployed?: readonly string[];
}

/**
 * Why redeploying these units to `to` is not legal now, or null (R18 to R20): each may be redeployed (`srUnitProblem`), `to` is another hex of
 * its region, the nations' allowances cover one redeployment per unit, and the units fit in `to` (AER27). Units may start in different hexes.
 */
export function srProblem(ctx: GameContext, state: GameState, unitIds: readonly string[], to: HexId, soFar: SrSoFar = {}, view: SrView = srView(ctx, state)): string | null {
  if (unitIds.length === 0) return "Choose at least one unit to redeploy.";
  if (new Set(unitIds).size !== unitIds.length) return "A unit is listed twice.";
  const units: Unit[] = [];
  for (const id of unitIds) {
    const u = state.units[id];
    if (!u) return `There is no unit ${id}.`;
    const problem = srUnitProblem(ctx, state, u, soFar.redeployed ?? [], view);
    if (problem) return problem;
    if (u.at === to) return `${id} is already in ${to}.`;
    const held = occupationSrProblem(ctx, state, u, to); // spec 14 R7c, AER31
    if (held) return held;
    if (!srRegion(ctx, state, u, view).has(to)) return `${id} cannot be redeployed to ${to}: ${srHexProblem(ctx, state, view, u, to) ?? `${to} cannot be reached from ${u.at} through the side's own supplied land.`}`;
    units.push(u);
  }
  return srAllowanceProblem(soFar.used ?? {}, srUnitCost(state, units)) ?? endProblem(ctx, state, units, to);
}

/** The hexes a unit may be redeployed to now (its region less its own hex, where it fits alone), in hex-id order; empty if it cannot be redeployed. */
export function srDestinations(ctx: GameContext, state: GameState, unit: Unit, soFar: SrSoFar = {}, view: SrView = srView(ctx, state)): HexId[] {
  if (srUnitProblem(ctx, state, unit, soFar.redeployed ?? [], view) !== null || srAllowanceProblem(soFar.used ?? {}, srUnitCost(state, [unit])) !== null) return [];
  return [...srRegion(ctx, state, unit, view)].filter((h) => h !== unit.at && occupationSrProblem(ctx, state, unit, h) === null && endProblem(ctx, state, [unit], h) === null).sort();
}
