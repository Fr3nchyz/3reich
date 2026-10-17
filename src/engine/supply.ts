import { controllerOf, controllingSide, sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { MapHex } from "./map";
import type { HexFeature } from "./terrain";
import type { ForceOwner, GameState, Side, Unit, UnitType } from "./types";
import { seaReaches } from "./naval-supply";
import { fortressSupplies, specialNets } from "./supply-sources";
import { adjacentHexes, canCross, enemyZocFor, ZOC_POLICY, ZOC_UNIT_TYPES, zocSources, type ZocPolicy } from "./zoc";

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
 *   Istanbul as transfer points): built as pure queries in naval-supply.ts (spec 12, ticket 12-2): a designation recorded in `GameState.naval`
 *   that passes `seaSupplyProblem` adds a source set here, `kind: "sea"`, tried last. `DESIGNATE_SEA_SUPPLY` (naval-actions.ts) records one at steps 6e and 9f;
 *   with no designation every answer is what it was. Chains through Gibraltar, Kiel and Istanbul (two fleets) are ticket 12-8.
 * - replacement counters, bridgeheads and units in the off-map boxes (always supplied, U.S. Box) are not checked.
 * - ZOC (Ref 7.0, 19.3, spec 13): only armor exerts ZOC into adjacent hexes, friendly units do not cancel it, and supply cannot pass
 *   a hex next to enemy armor. A unit next to a source is supplied unless both stand in the ZOC of the same enemy armor unit.
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
  /** For `via: "sea"`: the fleets that carry the supply, their port, and the receiving place the path ends at (source is that place). */
  sea?: { fleets: string[]; from: HexId; to: HexId };
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

export const byId = (a: string, b: string): number => {
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

/** Whether the state has the parts supply reads (a cheap shape check so a malformed state gives an empty answer, not a throw). */
const wellFormed = (state: GameState): boolean =>
  !!state && !!state.units && !!state.nations && !!state.control && Array.isArray(state.minorAllies) && Object.values(state.units).every((u) => !!u && typeof u === "object");

/** Every hex the side controls that is a supply source under the policy, in hex-id order. */
export function supplySources(ctx: GameContext, state: GameState, side: Side, policy: SupplyPolicy = SUPPLY_POLICY): HexId[] {
  if (!isSide(side) || !wellFormed(state)) return [];
  return sourceCandidates(ctx, policy.sourceFeatures)
    .filter((h) => capitalCounts(state, side, h.country) && controllingSide(ctx, state, h.id) === side)
    .map((h) => h.id)
    .sort(byHex);
}

const candidates = new WeakMap<GameContext, Map<string, MapHex[]>>();

/** The land hexes with one of the source features, whoever holds them: fixed by the map, so found once per context and feature list. */
function sourceCandidates(ctx: GameContext, features: readonly HexFeature[]): MapHex[] {
  let byFeatures = candidates.get(ctx);
  if (!byFeatures) candidates.set(ctx, (byFeatures = new Map<string, MapHex[]>()));
  const key = features.join(",");
  let hit = byFeatures.get(key);
  if (!hit) byFeatures.set(key, (hit = Object.values(ctx.map.hexes).filter((h) => h.land && h.features.some((f) => features.includes(f)))));
  return hit;
}

/** The hexes of enemy ground units: a line cannot enter them. */
function enemyGroundHexes(state: GameState, side: Side): Set<HexId> {
  const out = new Set<HexId>();
  for (const u of Object.values(state.units)) {
    const s = sideInWar(state, u.owner);
    if (s !== null && s !== side && ZOC_UNIT_TYPES.includes(u.type)) out.add(u.at);
  }
  return out;
}

/** What a line search needs that does not depend on the source set: the side's enemy ZOC, and which hexes a line may enter (land the side controls with no enemy ground unit), found once per hex. */
interface Obstacles {
  zoc: Set<HexId>;
  open: (h: HexId) => boolean;
}

const crossings = new WeakMap<GameContext, Map<HexId, readonly HexId[]>>();

/** The neighbours a ground unit could cross into from this hex, in `adjacentHexes` order: fixed by the map, so worked out once per hex. */
function crossable(ctx: GameContext, here: HexId): readonly HexId[] {
  let byHex = crossings.get(ctx);
  if (!byHex) crossings.set(ctx, (byHex = new Map<HexId, readonly HexId[]>()));
  let hit = byHex.get(here);
  if (!hit) byHex.set(here, (hit = adjacentHexes(ctx, here).filter((n) => canCross(ctx, here, n))));
  return hit;
}

/**
 * For one source set: the next hex towards a source from every hex a line reaches (a source maps to null). A
 * breadth-first search outward from the sources over land hexes the side controls without an enemy ground unit,
 * across hexsides ground units cross (`canCross`). An enemy-ZOC hex is reached but not passed through, unless it
 * is itself a source (19.3). Fixed neighbour order makes the nearest source and the path deterministic.
 */
function reach(ctx: GameContext, state: GameState, side: Side, sources: readonly HexId[], policy: SupplyPolicy, { zoc, open }: Obstacles): Map<HexId, HexId | null> {
  const isSource = new Set(sources);
  const next = new Map<HexId, HexId | null>();
  let frontier = sources.filter(open);
  for (const s of frontier) next.set(s, null);
  for (let depth = 0; frontier.length && (policy.maxLength === null || depth < policy.maxLength); depth++) {
    const following: HexId[] = [];
    for (const here of frontier) {
      if (zoc.has(here) && !isSource.has(here)) continue;
      const fromSource = zoc.has(here) ? zocSources(ctx, state, side, here) : [];
      for (const n of crossable(ctx, here)) {
        if (next.has(n) || !open(n)) continue;
        // Ref 19.3: a unit next to a source is not supplied when both stand in the ZOC of the same enemy unit.
        if (fromSource.length > 0 && zoc.has(n) && zocSources(ctx, state, side, n).some((id) => fromSource.includes(id))) continue;
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
  Object.values(state.units)
    .filter((u) => SUPPLY_CHECKED_TYPES.includes(u.type) && !!ctx.map.hexes[u.at] && sideInWar(state, u.owner) === side)
    .sort((a, b) => byId(a.id, b.id));

/** One source set and how far its lines reach: `next` maps every hex a line reaches to the next hex towards a source (null on a source). */
export interface SupplyReach {
  /**
   * "main": a group's capitals and the other sources of supplySources (19.2); "net": a special net of supply-sources.ts, tried after a Fortress;
   * "sea": the receiving place of a valid sea supply designation (19.31, naval-supply.ts), tried last, serving only the units it names.
   */
  kind: "main" | "net" | "sea";
  sources: ReadonlySet<HexId>;
  /** Searched when first read. */
  readonly next: ReadonlyMap<HexId, HexId | null>;
  /** Whether this set supplies a counter of this owner (never true for a "sea" set, which serves named units: see `units`). */
  serves: (owner: ForceOwner) => boolean;
  /** "sea" only: the ids of the units the designation names. */
  units?: ReadonlySet<string>;
  /** "sea" only: the fleets and their port, for `SupplyLine.sea`. */
  sea?: { fleets: string[]; from: HexId };
}

/**
 * Where a side's land lines reach, before any unit is looked at: the main source set of each group (19.2, by `groupOfOwner`) and then each special
 * net of supply-sources.ts, in the order `supplyStatus` tries them, with the side's enemy ZOC. A counter standing on a hex is supplied by land when the
 * first set that serves it reaches that hex (or a Fortress supplies it). Exported so a caller that asks the question for many hexes builds it once.
 */
export interface SupplyNetwork {
  side: Side;
  sources: HexId[];
  zoc: ReadonlySet<HexId>;
  reaches: SupplyReach[];
}

/** What `supplyNetwork` returns: the network, and the two things sea supply (naval-supply.ts) needs from the search that built it. */
export interface SeaNetwork extends SupplyNetwork {
  /** The land search of this network (same obstacles, same policy) from other sources, for the receiving place of a sea designation. */
  reachFrom: (sources: readonly HexId[]) => ReadonlyMap<HexId, HexId | null>;
  /** The source set a counter of this owner is supplied from. */
  groupOf: (owner: ForceOwner) => SupplyGroup;
}

export function supplyNetwork(ctx: GameContext, state: GameState, side: Side, policy: SupplyPolicy = SUPPLY_POLICY): SeaNetwork {
  const sources = supplySources(ctx, state, side, policy);
  const network: SeaNetwork = { side, sources, zoc: new Set(), reaches: [], reachFrom: () => new Map(), groupOf: (o) => groupOfOwner(side, o, policy) };
  if (!isSide(side) || !wellFormed(state)) return network;
  const blocked = enemyGroundHexes(state, side);
  const opened = new Map<HexId, boolean>();
  const open = (h: HexId): boolean => opened.get(h) ?? opened.set(h, !!ctx.map.hexes[h]?.land && controllingSide(ctx, state, h) === side && !blocked.has(h)).get(h)!;
  const obstacles: Obstacles = { zoc: enemyZocFor(ctx, state, side, policy.zoc), open };
  // Each set's search runs the first time its `next` is read: most units are supplied by their main set, so the special nets are often never searched.
  const lazyReach = (kind: SupplyReach["kind"], from: readonly HexId[], serves: SupplyReach["serves"]): SupplyReach => {
    let next: Map<HexId, HexId | null> | undefined;
    return { kind, sources: new Set(from), serves, get next() { return (next ??= reach(ctx, state, side, from, policy, obstacles)); } };
  };
  network.zoc = obstacles.zoc;
  const searched = new Map<string, ReadonlyMap<HexId, HexId | null>>();
  network.reachFrom = (from) => searched.get(from.join(",")) ?? searched.set(from.join(","), reach(ctx, state, side, from, policy, obstacles)).get(from.join(","))!;
  for (const g of ["axis", "western", "soviet"] as const) {
    const mine = sources.filter((s) => groupOfHex(ctx, state, side, s, policy) === g);
    if (mine.length) network.reaches.push(lazyReach("main", mine, (o) => groupOfOwner(side, o, policy) === g));
  }
  for (const net of specialNets(ctx, state, side)) network.reaches.push(lazyReach("net", net.sources, (o) => net.serves({ owner: o })));
  network.reaches.push(...seaReaches(ctx, state, network));
  return network;
}

/** Which of a side's units are in supply and along which path (deterministic: same state, same answer). */
export function supplyStatus(ctx: GameContext, state: GameState, side: Side, policy: SupplyPolicy = SUPPLY_POLICY): SupplyStatus {
  const network = supplyNetwork(ctx, state, side, policy);
  const status: SupplyStatus = { side, sources: network.sources, supplied: [], unsupplied: [] };
  if (!isSide(side) || !wellFormed(state)) return status;
  const lineIn = (u: Unit, next: ReadonlyMap<HexId, HexId | null>): SupplyLine | null => {
    if (!next.has(u.at)) return null;
    const path = [u.at];
    for (let h = next.get(u.at) ?? null; h !== null; h = next.get(h) ?? null) path.push(h);
    return { unitId: u.id, source: path[path.length - 1]!, path, via: "land" };
  };
  const seaLineIn = (u: Unit, r: SupplyReach): SupplyLine | null => {
    const land = r.units?.has(u.id) && r.sea ? lineIn(u, r.next) : null;
    return land ? { ...land, via: "sea", sea: { fleets: [...r.sea!.fleets], from: r.sea!.from, to: land.source } } : null;
  };
  for (const u of checkedUnits(ctx, state, side)) {
    const main = network.reaches.find((r) => r.kind === "main" && r.serves(u.owner));
    let line = main ? lineIn(u, main.next) : null;
    if (!line && fortressSupplies(ctx, state, side, u)) line = { unitId: u.id, source: u.at, path: [u.at], via: "land" };
    for (const r of network.reaches) if (!line && r.kind === "net" && r.serves(u.owner)) line = lineIn(u, r.next);
    for (const r of network.reaches) if (!line && r.kind === "sea") line = seaLineIn(u, r);
    if (line) status.supplied.push(line);
    else status.unsupplied.push(u.id);
  }
  return status;
}

/** Ids of the side's checked units that are out of supply, in unit-id order (the units 6e and 9f to 9h act on). */
export const unsuppliedUnits = (ctx: GameContext, state: GameState, side: Side, policy: SupplyPolicy = SUPPLY_POLICY): string[] =>
  supplyStatus(ctx, state, side, policy).unsupplied;

/** Whether one unit is in supply: true for counters whose supply is not checked (fleets and air units are always in supply, 19.3; replacements and bridgeheads are not checked), false if checked and cut or unknown. */
export function isUnitSupplied(ctx: GameContext, state: GameState, unitId: string, policy: SupplyPolicy = SUPPLY_POLICY): boolean {
  const u = wellFormed(state) ? state.units[unitId] : undefined;
  const side = u ? sideInWar(state, u.owner) : null;
  if (!u || side === null) return false;
  return !SUPPLY_CHECKED_TYPES.includes(u.type) || supplyStatus(ctx, state, side, policy).supplied.some((l) => l.unitId === unitId);
}
