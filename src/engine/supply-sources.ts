import { controllerOf, controllingSide } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { ForceOwner, GameState, Side, Unit } from "./types";

/**
 * The supply sources of Ref 19.2 beyond the capitals, as separate supply nets: each is a set of source hexes and the units it serves. A unit is
 * supplied if its line reaches a source of the main net for its side (supply.ts) or of any net here that serves it. Also the Fortress rule.
 *
 * Built (all `TODO(verify)` where noted):
 * - Libyan ports for the Axis, Egyptian ports for the Allies (not the U.S.S.R.), while the side controls them. TODO(verify, Ref 31.0, 32.0): these are
 *   "contingent on other eventualities"; the 18 German factors cap of 31.0 is not built, nor is anything for Egypt.
 * - Tunis and Beirut for the units of the nation that controls them (France, Free France or Vichy France only, and not shared).
 * - The east edge of the map down to hex Z53 for the U.S.S.R. while it controls the hexes (the edge hexes: the highest-numbered hex of rows A to Z).
 * - Konigsberg for German units and Durazzo for Italian ones in the 1939 and Campaign scenarios. TODO(verify): they should end when a normal land line
 *   reaches them; here they stay, which only matters if a line is cut again later.
 * - A Fortress hex supplies the units inside it, and only them (Ref 4.8, 19.2): Malta only while the Allies control Gibraltar, Alexandria and Suez
 *   (Suez city is the hex named Suez); Sevastopol for Russian units only (TODO(verify): its other conditions are not built).
 * Not built: the U.S.A. when London and Paris are lost, Greek units on Greek islands, Tangiers for Spanish units, sea supply (Ref 19.31).
 */

export interface SupplyNet {
  id: string;
  sources: HexId[];
  serves: (u: Pick<Unit, "owner">) => boolean;
}

/** Static lookups on the map, worked out once per context: they are read on every supply search. */
const statics = new WeakMap<GameContext, Map<string, unknown>>();
function once<T>(ctx: GameContext, key: string, make: () => T): T {
  let byKey = statics.get(ctx);
  if (!byKey) statics.set(ctx, (byKey = new Map<string, unknown>()));
  if (!byKey.has(key)) byKey.set(key, make());
  return byKey.get(key) as T;
}

const named = (ctx: GameContext, name: string): HexId | undefined => once(ctx, `name:${name}`, () => Object.values(ctx.map.hexes).find((h) => h.name === name)?.id);
const FRENCH: readonly ForceOwner[] = ["france", "free-france", "vichy-france"];

/** The east edge of the map as far south as Z53 (Ref 19.2): the highest-numbered hex of each row A to Z, when it is land. */
const eastEdge = (ctx: GameContext): readonly HexId[] => once(ctx, "east-edge", () => findEastEdge(ctx));
function findEastEdge(ctx: GameContext): HexId[] {
  const last = new Map<string, { col: number; id: HexId; land: boolean }>();
  for (const h of Object.values(ctx.map.hexes)) {
    const m = /^([A-Z])(\d+)$/.exec(h.id);
    if (!m) continue;
    const col = Number(m[2]);
    if (col > (last.get(m[1]!)?.col ?? -1)) last.set(m[1]!, { col, id: h.id, land: !!h.land });
  }
  return [...last.values()].filter((x) => x.land).map((x) => x.id);
}

export function specialNets(ctx: GameContext, state: GameState, side: Side): SupplyNet[] {
  const mine = (hex: HexId | undefined): hex is HexId => hex !== undefined && controllingSide(ctx, state, hex) === side;
  const nets: SupplyNet[] = [];
  const ports = (country: string) => once(ctx, `ports:${country}`, () => Object.values(ctx.map.hexes).filter((h) => h.land && h.country === country && h.features.includes("port")).map((h) => h.id)).filter(mine);
  if (side === "axis") nets.push({ id: "libya", sources: ports("libya"), serves: () => true });
  else nets.push({ id: "egypt", sources: ports("egypt"), serves: (u) => u.owner !== "ussr" });
  for (const name of ["Tunis", "Beirut"]) {
    const hex = named(ctx, name);
    const holder = hex === undefined ? null : controllerOf(ctx, state, hex);
    if (mine(hex) && holder !== null && FRENCH.includes(holder)) nets.push({ id: name.toLowerCase(), sources: [hex], serves: (u) => u.owner === holder });
  }
  if (side === "allies") nets.push({ id: "soviet-edge", sources: eastEdge(ctx).filter((h) => mine(h) && controllerOf(ctx, state, h) === "ussr"), serves: (u) => u.owner === "ussr" });
  if (ctx.scenario.id === "1939" || ctx.scenario.id === "campaign") {
    const k = named(ctx, "Konigsberg");
    const d = named(ctx, "Durazzo");
    if (side === "axis" && mine(k)) nets.push({ id: "konigsberg", sources: [k], serves: (u) => u.owner === "germany" });
    if (side === "axis" && mine(d)) nets.push({ id: "durazzo", sources: [d], serves: (u) => u.owner === "italy" });
  }
  return nets.filter((n) => n.sources.length > 0);
}

/** Whether a unit standing in a Fortress hex of its own side is supplied by that Fortress alone (Ref 19.2, 4.8). */
export function fortressSupplies(ctx: GameContext, state: GameState, side: Side, u: Pick<Unit, "at" | "owner">): boolean {
  if (state.fortresses[u.at] !== true || controllingSide(ctx, state, u.at) !== side) return false;
  const name = ctx.map.hexes[u.at]?.name;
  if (name === "Malta") return ["Gibraltar", "Alexandria", "Suez"].every((n) => { const hex = named(ctx, n); return hex !== undefined && controllingSide(ctx, state, hex) === "allies"; });
  if (name === "Sevastopol") return u.owner === "ussr";
  return true;
}
