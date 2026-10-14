import { controllerOf, controllingSide, sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { HexFeature } from "./terrain";
import type { ForceOwner, GameState, Side, Unit, UnitType } from "./types";
import { adjacentHexes, canCross, enemyZocFor, ZOC_POLICY, ZOC_UNIT_TYPES, type ZocPolicy } from "./zoc";

/**
 * Supply (spec 03, roadmap 5.5). Pure queries only: nothing here is wired to a step or an action yet.
 * Steps 6e and 9f to 9h will call `supplyStatus` / `unsuppliedUnits` and apply the printed penalty.
 *
 * The rule text: spec 03 cites "Ref 10.0", but docs/RULES.md has Ref 10.0 as the spending limit. The only printed
 * text found is the Advanced Third Reich rulebook on the web (docs/RULES.md "Web research": facts, read through a
 * summarising tool, not checked against the PC manual), which puts supply in section 19. This module follows it:
 * 19.2 sources: a Major Power's capital, and a minor country's capital if that minor fights, supply their
 *   controlling side, without limit on the number of units; 19.3 a unit is supplied when a line of friendly-controlled
 *   hexes leads to a source with no enemy ZOC on any hex of the line; ZOC on the unit's hex or on the source does not
 *   block it (supply enters a ZOC but does not pass through one); a line may cross a Crossing Arrow; Western Allied and
 *   Soviet supply are not traced from each other's sources (their lines may cross each other's hexes); naval and air
 *   units are always in supply; 19.4 an unsupplied unit may still attack (so the `isSupplied` hook of
 *   attack-rules.ts stays true).
 *
 * Not settled by what we have, each a TODO(verify, Ref 19.x) and kept out or made a policy field:
 * - sources not built: the Soviet east map edge (down to Z53) and Moscow's fall, Libyan, Egyptian, Tunis and Beirut
 *   ports, Malta and Sevastopol, fortresses (supply the units inside only), Greek islands, Tangiers, Konigsberg and
 *   Durazzo, the U.S.A. when London and Paris are lost; the Ref 31.0 cap of 18 German factors from Libya.
 * - French units in Europe trace only from Paris until 1942; British units in France may not trace through Vichy.
 * - which minor capitals count ("if it has its own armed forces"): here a minor that fights on the side now.
 * - a maximum length: none found (`maxLength: null`); the unit's own hex must be friendly-controlled here.
 * - sea supply (19.31: a designated fleet, one ground unit or airbase per naval factor, ports, Gibraltar, Kiel and
 *   Istanbul as transfer points) needs fleet designation at 6e / 9f and a port-to-port rule: a documented stub.
 * - replacement counters, bridgeheads and units in the off-map boxes (always supplied, U.S. Box) are not checked.
 * - whether a friendly unit cancels an enemy ZOC for supply (spec 03 says so; `ZOC_POLICY`).
 */

/** Ground units, whose supply is checked, and airbases, which 9h relocates when unsupplied. Naval and air units are always supplied (19.3). */
export const SUPPLY_CHECKED_TYPES: readonly UnitType[] = [...ZOC_UNIT_TYPES, "airbase"];

/** Which source set supplies a unit: the Axis, the Western Allies (all Allies but the Soviets), or the Soviets. */
export type SupplyGroup = "axis" | "western" | "soviet";

export interface SupplyPolicy {
  /** Hex features that make a controlled hex a supply source. */
  sourceFeatures: readonly HexFeature[];
  /** Longest line in hexes from the source, or null for no limit. */
  maxLength: number | null;
  /** Whether Western Allied and Soviet supply are traced apart (19.3). */
  separateAlliedGroups: boolean;
  /** How friendly units cancel enemy ZOC along the line (shared with movement). */
  zoc: ZocPolicy;
}
export const SUPPLY_POLICY: SupplyPolicy = { sourceFeatures: ["capital", "capital-port"], maxLength: null, separateAlliedGroups: true, zoc: ZOC_POLICY };

/** How one unit is supplied: the hexes from its own hex (first) to the source (last), and how. */
export interface SupplyLine {
  unitId: string;
  source: HexId;
  path: HexId[];
  via: "land" | "sea";
}

export interface SupplyStatus {
  side: Side;
  /** The sources the side holds, in hex-id order (including ones whose line is cut). */
  sources: HexId[];
  /** One line per supplied unit, in unit-id order. */
  supplied: SupplyLine[];
  /** Ids of the checked units with no line, in unit-id order. */
  unsupplied: string[];
}

const byId = (a: string, b: string): number => {
  const na = Number(a.replace(/\D/g, ""));
  const nb = Number(b.replace(/\D/g, ""));
  return na !== nb ? na - nb : a < b ? -1 : a > b ? 1 : 0;
};
const byHex = (a: HexId, b: HexId): number => (a < b ? -1 : a > b ? 1 : 0);
const isSide = (s: unknown): s is Side => s === "axis" || s === "allies";

/** The source set a counter of this owner is supplied from. */
const groupOfOwner = (side: Side, owner: ForceOwner, policy: SupplyPolicy): SupplyGroup =>
  side === "axis" ? "axis" : policy.separateAlliedGroups && owner === "ussr" ? "soviet" : "western";

/** Which source set a controlled hex belongs to: by who controls it (a Soviet-held Moscow supplies Soviets). */
function groupOfHex(ctx: GameContext, state: GameState, side: Side, hex: HexId, policy: SupplyPolicy): SupplyGroup {
  const c = controllerOf(ctx, state, hex);
  return c === null ? "western" : groupOfOwner(side, c, policy);
}

/** Whether a capital hex counts: a Major Power's always; a minor country's while that minor fights on the side. */
function capitalCounts(state: GameState, side: Side, country: string | undefined): boolean {
  if (country === undefined) return false;
  return country in (state.nations ?? {}) || sideInWar(state, country as ForceOwner) === side;
}

/** Every hex the side controls that is a supply source under the policy, in hex-id order. */
export function supplySources(ctx: GameContext, state: GameState, side: Side, policy: SupplyPolicy = SUPPLY_POLICY): HexId[] {
  if (!isSide(side)) return [];
  return Object.values(ctx.map.hexes)
    .filter((h) => h.land && h.features.some((f) => policy.sourceFeatures.includes(f)) && capitalCounts(state, side, h.country) && controllingSide(ctx, state, h.id) === side)
    .map((h) => h.id)
    .sort(byHex);
}

/**
 * Sea supply (19.31). STUB: no unit is supplied by sea until fleet designation exists.
 * TODO(verify, Ref 19.31): the designation at 6e / 9f, naval factors as capacity (one unit or airbase each), the port
 * pairs a fleet may join, transfer points (Gibraltar, Kiel, Istanbul), interception.
 */
export function seaSupplyLine(_ctx: GameContext, _state: GameState, _side: Side, _unit: Unit): SupplyLine | null {
  return null;
}

/** The hexes of enemy ground units: a line cannot enter them. */
function enemyGroundHexes(state: GameState, side: Side): Set<HexId> {
  const out = new Set<HexId>();
  for (const u of Object.values(state.units ?? {})) {
    const s = sideInWar(state, u.owner);
    if (s !== null && s !== side && ZOC_UNIT_TYPES.includes(u.type)) out.add(u.at);
  }
  return out;
}

/**
 * For one source set: the next hex towards a source from every hex a line reaches (a source maps to null). A
 * breadth-first search outward from the sources over land hexes the side controls without an enemy ground unit,
 * across hexsides ground units cross (`canCross`). An enemy-ZOC hex is reached but not passed through, unless it
 * is itself a source (19.3). Fixed neighbour order makes the nearest source and the path deterministic.
 */
function reach(ctx: GameContext, state: GameState, side: Side, sources: readonly HexId[], policy: SupplyPolicy): Map<HexId, HexId | null> {
  const zoc = enemyZocFor(ctx, state, side, policy.zoc);
  const blocked = enemyGroundHexes(state, side);
  const open = (h: HexId) => !!ctx.map.hexes[h]?.land && controllingSide(ctx, state, h) === side && !blocked.has(h);
  const isSource = new Set(sources);
  const next = new Map<HexId, HexId | null>();
  let frontier = sources.filter(open);
  for (const s of frontier) next.set(s, null);
  for (let depth = 0; frontier.length && (policy.maxLength === null || depth < policy.maxLength); depth++) {
    const following: HexId[] = [];
    for (const here of frontier) {
      if (zoc.has(here) && !isSource.has(here)) continue;
      for (const n of adjacentHexes(ctx, here)) {
        if (next.has(n) || !open(n) || !canCross(ctx, here, n)) continue;
        next.set(n, here);
        following.push(n);
      }
    }
    frontier = following;
  }
  return next;
}

/** The units of a side whose supply is checked, standing on map hexes (not in a box), in unit-id order. */
const checkedUnits = (ctx: GameContext, state: GameState, side: Side): Unit[] =>
  Object.values(state.units ?? {})
    .filter((u) => SUPPLY_CHECKED_TYPES.includes(u.type) && !!ctx.map.hexes[u.at] && sideInWar(state, u.owner) === side)
    .sort((a, b) => byId(a.id, b.id));

/** Which of a side's units are in supply and along which path (deterministic: same state, same answer). */
export function supplyStatus(ctx: GameContext, state: GameState, side: Side, policy: SupplyPolicy = SUPPLY_POLICY): SupplyStatus {
  const sources = supplySources(ctx, state, side, policy);
  const status: SupplyStatus = { side, sources, supplied: [], unsupplied: [] };
  if (!isSide(side) || !state.units) return status;
  const reached = new Map<SupplyGroup, Map<HexId, HexId | null>>();
  for (const g of ["axis", "western", "soviet"] as const) {
    const mine = sources.filter((s) => groupOfHex(ctx, state, side, s, policy) === g);
    if (mine.length) reached.set(g, reach(ctx, state, side, mine, policy));
  }
  for (const u of checkedUnits(ctx, state, side)) {
    const next = reached.get(groupOfOwner(side, u.owner, policy));
    let line: SupplyLine | null = null;
    if (next?.has(u.at)) {
      const path = [u.at];
      for (let h = next.get(u.at) ?? null; h !== null; h = next.get(h) ?? null) path.push(h);
      line = { unitId: u.id, source: path[path.length - 1]!, path, via: "land" };
    }
    line ??= seaSupplyLine(ctx, state, side, u);
    if (line) status.supplied.push(line);
    else status.unsupplied.push(u.id);
  }
  return status;
}

/** Ids of the side's checked units that are out of supply, in unit-id order (the units 6e and 9f to 9h act on). */
export const unsuppliedUnits = (ctx: GameContext, state: GameState, side: Side, policy: SupplyPolicy = SUPPLY_POLICY): string[] =>
  supplyStatus(ctx, state, side, policy).unsupplied;

/** Whether one unit is in supply: false if it is out of supply or is a counter whose supply is not checked. */
export function isUnitSupplied(ctx: GameContext, state: GameState, unitId: string, policy: SupplyPolicy = SUPPLY_POLICY): boolean {
  const u = state.units?.[unitId];
  const side = u ? sideInWar(state, u.owner) : null;
  return !!u && side !== null && supplyStatus(ctx, state, side, policy).supplied.some((l) => l.unitId === unitId);
}
