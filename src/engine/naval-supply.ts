import { controllingSide, sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { navalOf, useOf, type SeaSupplyDesignation } from "./naval-record";
import { hexOf, isOneHexIsland, isPort, portFronts, portsOf } from "./naval-ports";
import { seaRoute } from "./naval-routes";
import { SEA_SUPPLY_UNITS_PER_FACTOR } from "./naval-rules";
import type { SeaNetwork, SupplyReach } from "./supply";
import type { Front } from "./map";
import type { GameState, Side, Unit, UnitType } from "./types";
import { ZOC_UNIT_TYPES } from "./zoc";

/**
 * Sea supply, the rules (spec 12 R6, R7, C4; Ref 19.31, 19.2, 26.0, 27.0): whether a designation recorded in `GameState.naval` is valid, and the
 * source sets that `supplyNetwork` (supply.ts) adds for the valid ones. Pure queries: the action that records a designation is in naval-actions.ts, and the
 * entry points that build a network of their own are in naval-supply-options.ts. This module takes the side's land network as it stands (the
 * main sources and the special nets), so it imports nothing from supply.ts at run time.
 *
 * Built: the checks of R7 in the order `designationProblem` lists them; capacity of one counter per naval factor over every designation of the
 * Player Turn (N8, N9); two-fleet chains through friendly two-Front ports (ticket 12-8); the group rule (the Axis; the Western Allies, British and French carrying for each other; the Soviets alone). Not built:
 * Bridgeheads as destinations (Release IV), the German-Italian ban of Ref 30.0
 * before they are allied (N6), the Ref 31.0 cap in Africa (N13), the interception rules (a supply fleet cannot be intercepted; nothing here moves).
 *
 * TODO(verify), spec 12 part J: N6 (the Axis is one group for supply fleets), N8 and N9 (capacity counts over the whole Player Turn and is charged when
 * named, even for a unit already supplied by land), N10 (the port must be supplied now, the place may stand in a zone), N11 (the islands), N12 (a Libyan port
 * counts as supplied), N35 (several fleets in one designation fill in the order listed).
 */

// N5 (spec 12 R3): the Baltic and Black Sea share the Eastern Front name, but are separate bodies of water.
// Use the existing route query to identify their water, not a new tracer. N4 explicitly places Stettin (no sea hexside) in the Baltic.
const seas = new WeakMap<GameContext, Map<HexId, string | undefined>>();
function easternSea(ctx: GameContext, hex: HexId): string | undefined {
  let cache = seas.get(ctx);
  if (!cache) { cache = new Map(); seas.set(ctx, cache); }
  if (!cache.has(hex)) cache.set(hex, hex === "K32" || seaRoute(ctx, hex, "D44") ? "baltic" : seaRoute(ctx, hex, "V38") ? "black" : undefined);
  return cache.get(hex);
}
/** An Eastern leg cannot silently jump from Baltic to Black Sea (Ref 21.1; spec 12 R3/R7, N5). */
export function sameSupplySea(ctx: GameContext, from: HexId, to: HexId, front: Front): boolean {
  if (front !== "eastern") return true;
  const a = easternSea(ctx, from), b = easternSea(ctx, to);
  return a === undefined || b === undefined || a === b;
}

/** Different base ports distinguish serial legs from the existing pooled fleets at one port (spec 12 R7, Ref 19.31). No new record field. */
export const isSupplyChain = (state: GameState, d: SeaSupplyDesignation): boolean =>
  d.fleets.some((id) => state.units[id]?.at !== d.from);

/** The friendly two-Front transfer port, lowest hex first, or no possible link (spec 12 R3/R7; Ref 19.31, 21.1). */
export function supplyChainLink(ctx: GameContext, state: GameState, d: SeaSupplyDesignation): HexId | null {
  if (d.fleets.length !== 2 || state.units[d.fleets[0]!]?.at !== d.from) return null;
  const second = state.units[d.fleets[1]!];
  if (!second) return null;
  const firstFronts = portFronts(ctx, d.from), lastFronts = portFronts(ctx, d.to), secondFronts = portFronts(ctx, second.at);
  // A fleet in a two-Front port already covers either Front; same-Front fleets use the ordinary pooled designation.
  if (firstFronts.some((f) => lastFronts.includes(f))) return null;
  return portsOf(ctx).sort().find((p) => {
    const fronts = portFronts(ctx, p);
    return fronts.length === 2 && controllingSide(ctx, state, p) === controllingSide(ctx, state, d.to)
      && firstFronts.some((a) => fronts.includes(a) && sameSupplySea(ctx, d.from, p, a) && lastFronts.some((b) => b !== a && fronts.includes(b) && secondFronts.includes(b) && sameSupplySea(ctx, p, d.to, b) && sameSupplySea(ctx, p, second.at, b)));
  }) ?? null;
}

/** The counters a fleet can feed: ground units and airbases, the same as the units whose supply is checked (`SUPPLY_CHECKED_TYPES`; a test keeps the two equal). */
export const FED_TYPES: readonly UnitType[] = [...ZOC_UNIT_TYPES, "airbase"];

/** A hex with a name for a sentence: "Cagliari (AA19)". */
const where = (ctx: GameContext, hex: HexId): string => (hexOf(ctx, hex)?.name ? `${hexOf(ctx, hex)!.name} (${hex})` : hex);

/** True for a real array of distinct strings (a hole in a sparse array, a number, a repeat is refused). */
function distinctStrings(x: unknown): x is string[] {
  if (!Array.isArray(x) || x.length === 0 || x.length > 200) return false;
  for (let i = 0; i < x.length; i++) if (typeof x[i] !== "string") return false;
  return new Set(x).size === x.length;
}

/** The Fronts a receiving place serves: a port by its table, a one-hex island that is no port by the Front of its hex. */
export const placeFronts = (ctx: GameContext, hex: HexId): readonly Front[] => (isPort(ctx, hex) ? portFronts(ctx, hex) : ctx.map.hexes[hex] ? [ctx.map.hexes[hex].front] : []);

/** Whether a land supply line from one of the network's sources reaches the hex for a counter of this owner (a main set or a special net; Fortress self-supply and sea sets do not count). TODO(verify) (N10, N12). */
export function portReached(network: SeaNetwork, hex: HexId, owner: Unit["owner"]): boolean {
  return network.reaches.some((r) => r.serves(owner) && r.next.has(hex));
}

/** The units each fleet can still carry after the designations before it: fleets at one base fill in order; a two-leg chain charges every named unit to BOTH fleets (spec 12 R7; Ref 19.31). TODO(verify) (N35, N9). */
export function freeCapacity(state: GameState, earlier: readonly SeaSupplyDesignation[]): (fleet: string) => number {
  const used = new Map<string, number>();
  const room = (id: string): number => (state.units[id]?.strength ?? 0) * SEA_SUPPLY_UNITS_PER_FACTOR - (used.get(id) ?? 0);
  for (const d of earlier) {
    if (isSupplyChain(state, d)) {
      for (const f of d.fleets) used.set(f, (used.get(f) ?? 0) + d.units.length);
      continue;
    }
    let owed = d.units.length;
    for (const f of d.fleets) {
      const take = Math.min(owed, room(f));
      used.set(f, (used.get(f) ?? 0) + take);
      owed -= take;
    }
  }
  return room;
}

/**
 * The first rule this designation breaks, in one sentence, or null if it is valid, given the designations before it that stand (R7). `earlier` are
 * the valid designations of the same Player Turn already counted: they use up capacity and name units.
 */
export function designationProblem(ctx: GameContext, state: GameState, network: SeaNetwork, d: SeaSupplyDesignation, earlier: readonly SeaSupplyDesignation[]): string | null {
  const side: Side = network.side;
  if (!d || typeof d !== "object" || !distinctStrings(d.fleets) || !distinctStrings(d.units) || typeof d.from !== "string" || typeof d.to !== "string") {
    return "A sea supply names one or more distinct fleets, one or more distinct units, the port of the fleets and the place that receives the supply (Ref 19.31).";
  }
  const fleets = d.fleets.map((id) => state.units[id]);
  const chain = isSupplyChain(state, d);
  for (const [i, f] of fleets.entries()) {
    const id = d.fleets[i]!;
    if (!f || f.type !== "fleet") return `${id} is not a fleet on the map: only fleets carry supply by sea (Ref 19.31).`;
    if (sideInWar(state, f.owner) !== side) return `${id} is not a fleet of the ${side} side.`;
    if ((!chain || i === 0) && f.at !== d.from) return `${id} is at ${where(ctx, f.at)}, not at ${where(ctx, d.from)}: the fleets of one supply sail from one port.`;
    if (!isPort(ctx, f.at)) return `${where(ctx, f.at)} is not a port: fleets are based in ports (Ref 4.7).`;
    const use = useOf(state, id);
    if (use !== undefined && use !== "supply") return use === "new" ? `${id} was built this Game Turn and does nothing until the next (Ref 21.3).` : `${id} has already been used this Game Turn (${use}): a fleet does one thing in a Game Turn (Ref 21.3).`;
  }
  if (!isPort(ctx, d.from)) return `${where(ctx, d.from)} is not a port: fleets are based in ports (Ref 4.7).`;
  if (!isPort(ctx, d.to) && !isOneHexIsland(ctx, d.to)) return `${where(ctx, d.to)} is not a port or a one-hex island: sea supply is carried to a friendly port or island (Ref 19.2, 19.31).`;
  if (controllingSide(ctx, state, d.to) !== side) return `${where(ctx, d.to)} is not held by the ${side} side, so it cannot receive supply.`;
  const common = portFronts(ctx, d.from).filter((front) => placeFronts(ctx, d.to).includes(front) && sameSupplySea(ctx, d.from, d.to, front));
  if (chain && !supplyChainLink(ctx, state, d)) return "A chain needs two fleets, one on each side of a friendly two-Front port: Gibraltar, Kiel or Istanbul (Ref 19.31, 21.1).";
  if (!chain && common.length === 0) return `The fleet at ${where(ctx, d.from)} serves the ${portFronts(ctx, d.from).join(" and ")} Front and ${where(ctx, d.to)} the ${placeFronts(ctx, d.to).join(" and ")} Front: supply by sea stays on one Front (a line between Fronts needs a second fleet through Gibraltar, Kiel or Istanbul).`;
  const group = network.groupOf(fleets[0]!.owner);
  if (fleets.some((f) => network.groupOf(f!.owner) !== group)) return "The fleets of one supply must all serve the same group: the Axis, the Western Allies or the Soviets (Ref 26.0, 27.0).";
  const named = new Set(earlier.flatMap((e) => e.units));
  for (const id of d.units) {
    const u = state.units[id];
    if (!u || !FED_TYPES.includes(u.type) || !hexOf(ctx, u.at)) return `${id} is not a ground unit or airbase on the map: only those are fed by sea (Ref 19.31).`;
    if (sideInWar(state, u.owner) !== side) return `${id} is not a unit of the ${side} side.`;
    if (network.groupOf(u.owner) !== group) return `${id} belongs to another group than the fleet: the Axis, the Western Allies and the Soviets do not carry supply for each other (Ref 26.0, 27.0).`;
    if (named.has(id)) return `${id} is already named in another sea supply this Player Turn.`;
  }
  if ((chain ? fleets.slice(0, 1) : fleets).some((f) => !portReached(network, d.from, f!.owner))) return `${where(ctx, d.from)} has no land supply line to a supply source, so the fleet there has nothing to carry (Ref 19.31).`;
  const land = network.reachFrom([d.to]);
  for (const id of d.units) {
    const at = state.units[id]!.at;
    if (!land.has(at)) return `${id} at ${where(ctx, at)} has no land line to ${where(ctx, d.to)}: the units must be joined to the receiving place by hexes the side holds, with no enemy armor zone of control between (Ref 19.3, 19.31).`;
  }
  const room = freeCapacity(state, earlier);
  const free = chain ? Math.min(...d.fleets.map(room)) : d.fleets.reduce((n, id) => n + room(id), 0);
  if (d.units.length > free) return `The fleet${d.fleets.length > 1 ? "s carry" : " carries"} only ${free} more unit${free === 1 ? "" : "s"} (one per naval factor, Ref 19.31), and ${d.units.length} are named.`;
  return null;
}

/** The side's recorded designations in order, each with its problem (null if valid); a valid one counts against the ones after it. A designation of the other side's fleets comes back with its problem. */
export function checkDesignations(ctx: GameContext, state: GameState, network: SeaNetwork): { designation: SeaSupplyDesignation; problem: string | null }[] {
  if (!state.naval) return [];
  const standing: SeaSupplyDesignation[] = [];
  const out: { designation: SeaSupplyDesignation; problem: string | null }[] = [];
  for (const d of navalOf(state).supply) {
    const problem = designationProblem(ctx, state, network, d, standing);
    if (problem === null) standing.push(d);
    out.push({ designation: d, problem });
  }
  return out;
}

/** The source sets of the valid designations, in the order they were made: each is searched from its receiving place and serves only the units it names. */
export function seaReaches(ctx: GameContext, state: GameState, network: SeaNetwork): SupplyReach[] {
  return checkDesignations(ctx, state, network)
    .filter((c) => c.problem === null)
    .map(({ designation: d }) => ({
      kind: "sea" as const,
      sources: new Set([d.to]),
      serves: () => false,
      units: new Set(d.units),
      sea: { fleets: [...d.fleets], from: d.from },
      get next() {
        return network.reachFrom([d.to]);
      },
    }));
}
