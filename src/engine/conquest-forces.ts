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
 * Off, nothing is kept. As built the units are those of any owner at war on the other side, not only Major Powers' (a Minor-Ally's unit keeps its hex too), and
 * the hex keeps whatever control it had (a minor's land nobody held is recorded as nobody's, `passControl`).
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
  /**
   * The land of the country itself, for a country whose hexes nobody need hold (a minor country, a colony, Eastern Europe; spec 14 R9, Ref 16.0: "every hex of
   * the country passes to the conqueror"). Each of these hexes passes whoever holds it now (the fallen country, nobody, or an enemy of the conqueror), except
   * the kept hexes and the hexes already held by the conqueror's side, which do not change. TODO(verify) V37.
   */
  land?: ReadonlySet<HexId>;
}

/** The land each way: hexes now the conqueror's, and hexes that nobody controls any more. Both in hex-id order. */
export interface Passed {
  toConqueror: HexId[];
  toNobody: HexId[];
}

const byId = (a: HexId, b: HexId): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Applies a PassRule: every hex held by one of `rule.from` goes to the conqueror or to nobody (`control[hex] = null`), except the hexes kept, and every hex of
 * `rule.land` goes to the conqueror (see there). A kept hex of the country's land that nobody holds is recorded as nobody's, so that it is not read as the
 * neutral land of a country that is gone (movement.ts); it is not reported as passed.
 */
export function passControl(ctx: GameContext, state: GameState, rule: PassRule): { state: GameState; passed: Passed } {
  const passed: Passed = { toConqueror: [], toNobody: [] };
  const control = { ...state.control };
  const now = controlMap(ctx, state);
  const conquerorSide = sideInWar(state, rule.to);
  const held = [...now].filter(([hex, owner]) => rule.from.includes(owner) && !rule.keep.has(hex) && ctx.map.hexes[hex] !== undefined);
  const heldIds = new Set(held.map(([hex]) => hex));
  for (const [hex, owner] of held.sort(([a], [b]) => byId(a, b))) {
    const home = rule.isHome(ctx.map.hexes[hex]!, owner);
    control[hex] = home ? rule.to : null;
    (home ? passed.toConqueror : passed.toNobody).push(hex);
  }
  for (const hex of [...(rule.land ?? [])].sort(byId)) {
    if (heldIds.has(hex) || ctx.map.hexes[hex]?.land == null) continue;
    const owner = now.get(hex);
    if (rule.keep.has(hex)) {
      if (owner === undefined && control[hex] === undefined) control[hex] = null;
      continue;
    }
    if (owner === rule.to || (owner !== undefined && conquerorSide !== null && sideInWar(state, owner) === conquerorSide)) continue;
    control[hex] = rule.to;
    passed.toConqueror.push(hex);
  }
  passed.toConqueror.sort(byId);
  return { state: { ...state, control }, passed };
}
