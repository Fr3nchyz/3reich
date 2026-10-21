import { CONTROL_CHANGING_TYPES, controlMap, sideInWar } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import type { MapHex } from "./map";
import type { ForceOwner, GameState, Side, UnitType } from "./types";

/**
 * The two parts of a conquest that do not depend on which country fell (spec 14 C8, steps 1 and 2): the units and pools that leave the game,
 * and the land that changes hands. `fall()` (conquest.ts) uses them for a Major Power; ticket 14-6 and the minor-country spec use the same two
 * calls for a minor country or a colony. Pure: each returns a new state.
 */

/** A unit that left the game, as the event lists it. */
export interface RemovedUnit {
  id: string;
  owner: ForceOwner;
  type: UnitType;
  strength: number;
}

/** Takes these units off the map for good. The caller words it once (UNITS_REMOVED_BY_CONQUEST); there is no UNIT_ELIMINATED for each. */
export function removeUnits(state: GameState, ids: Iterable<string>): { state: GameState; removed: RemovedUnit[] } {
  const units = { ...state.units };
  const removed: RemovedUnit[] = [];
  for (const id of ids) {
    const u = units[id];
    if (!u) continue;
    delete units[id];
    removed.push({ id, owner: u.owner, type: u.type, strength: u.strength });
  }
  return { state: { ...state, units }, removed };
}

/** Takes the Force Pool and the Allowable Builds of these owners away: nothing of a conquered country can be built again (TODO(verify) V10). */
export function removePools(state: GameState, owners: readonly ForceOwner[]): GameState {
  const pools = { ...state.pools };
  for (const o of owners) delete pools[o];
  return { ...state, pools };
}

/**
 * TODO(verify) V12 (Ref 16.0, 18.1): the manual keeps the hexes of hostile Major-Power ground units that can still trace supply, and the supply line they
 * use, out of the land that passes to the conqueror. Ticket 14-23 adds the supply line; until then, only the hexes those units stand on stay as they are.
 * Off, nothing is kept.
 */
export const TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX = true;

/** The hexes with a ground unit of a side other than `side` (a side in the war, that is) whose land is not passed to the conqueror (`TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX`). */
export function hostileGroundHexes(state: GameState, side: Side): Set<HexId> {
  const out = new Set<HexId>();
  if (!TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX) return out;
  for (const u of Object.values(state.units)) {
    const s = sideInWar(state, u.owner);
    if (s !== null && s !== side && CONTROL_CHANGING_TYPES.includes(u.type)) out.add(u.at);
  }
  return out;
}

/** How land changes hands when a country falls. */
export interface PassRule {
  /** Whose land is concerned: the fallen country and the Minor-Allies that go with it. */
  from: readonly ForceOwner[];
  /** The conqueror, who takes the land that is `isHome`. */
  to: ForceOwner;
  /** Whether a hex held by `owner` passes to the conqueror (true) or becomes nobody's (false). */
  isHome: (hex: MapHex, owner: ForceOwner) => boolean;
  /** Hexes that stay as they are. */
  keep: ReadonlySet<HexId>;
}

/** The land each way: hexes now the conqueror's, and hexes that nobody controls any more. Both in hex-id order. */
export interface Passed {
  toConqueror: HexId[];
  toNobody: HexId[];
}

/** Applies a PassRule: every hex held by one of `rule.from` goes to the conqueror or to nobody (`control[hex] = null`), except the hexes kept. */
export function passControl(ctx: GameContext, state: GameState, rule: PassRule): { state: GameState; passed: Passed } {
  const passed: Passed = { toConqueror: [], toNobody: [] };
  const control = { ...state.control };
  const held = [...controlMap(ctx, state)].filter(([hex, owner]) => rule.from.includes(owner) && !rule.keep.has(hex) && ctx.map.hexes[hex] !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [hex, owner] of held) {
    const home = rule.isHome(ctx.map.hexes[hex]!, owner);
    control[hex] = home ? rule.to : null;
    (home ? passed.toConqueror : passed.toNobody).push(hex);
  }
  return { state: { ...state, control }, passed };
}
