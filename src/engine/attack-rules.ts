import type { GameContext } from "./context";
import { defenseMultiplier } from "./terrain";
import { adjacent, hex, hexsideId, neighbors, hexId, type HexId } from "./hex";
import type { Front } from "./map";
import { sideOfOwner } from "./setup";
import { oddsColumn, type OddsColumn } from "./combat";
import type { ForceOwner, GameState, PowerId, Side, Unit, UnitType } from "./types";
import { atWar, isMajorPower } from "./war";

/**
 * Who may attack whom, and the numbers of one ground attack (Ref 12.1, spec 04). Pure helpers
 * shared by the attack action and the loss allocation.
 */

/**
 * Counters that fight on the ground. TODO(verify): whether Replacement counters attack and
 * defend like other ground units; here they do, as they count toward stacking.
 */
export const GROUND_COMBAT_TYPES: readonly UnitType[] = ["infantry", "armor", "airborne", "replacement"];
export const isGroundCombatUnit = (u: Pick<Unit, "type">): boolean => GROUND_COMBAT_TYPES.includes(u.type);

/**
 * A hex can be attacked only once in a Player Turn. TODO(verify): the manual text is not in the
 * repo; the PC README only says each unit attacks one hex (14.23). Set false to allow repeats.
 */
export const ONE_ATTACK_PER_HEX = true;

/**
 * Advancing into the hex the defenders left, after the battle, by the units that attacked.
 * TODO(verify): the rule text for advance after combat (who, how many, stacking, ZOC) is not
 * in the repo; this takes the simplest reading and the control engine must refine it.
 */
export const ADVANCE_AFTER_COMBAT = true;

/** Hook for the supply engine: whether the unit is supplied and so may attack. TODO(verify): Ref 10.0 supply, not built; everyone is supplied. */
export const isSupplied = (_ctx: GameContext, _state: GameState, _unit: Unit): boolean => true;

/** Hook for front options: whether the side may attack on that Front. TODO(verify): Ref 11.2 Offensive Option, built elsewhere; every Front allows it. */
export const frontAllowsAttack = (_ctx: GameContext, _state: GameState, _side: Side, _front: Front): boolean => true;

const POWERS: readonly PowerId[] = ["germany", "italy", "ussr", "britain", "france", "usa"];

/** Major Powers that are in the war on a side; a neutral, Vichy or absent power is not. */
function inTheWar(state: GameState, o: PowerId): boolean {
  const status = state.nations[o]?.status;
  return status === "axis" || status === "allied";
}

/** The Major Powers an owner fights for: itself, or for a minor force the powers of its side. */
function patrons(state: GameState, o: ForceOwner): PowerId[] {
  if (isMajorPower(o)) return inTheWar(state, o) ? [o] : [];
  return POWERS.filter((p) => inTheWar(state, p) && sideOfOwner(p) === sideOfOwner(o));
}

/**
 * Whether two owners' units fight each other: on opposite sides, and at war. Two Major Powers must
 * be at war with each other; a minor force (Poland, a Minor-Ally...) fights whoever its side's
 * Major Powers are at war with. TODO(verify): alliance wars (Ref 13.0) are not modelled.
 */
export function isEnemy(state: GameState, a: ForceOwner, b: ForceOwner): boolean {
  if (sideOfOwner(a) === sideOfOwner(b)) return false;
  if (atWar(state, a, b)) return true;
  if (isMajorPower(a) && isMajorPower(b)) return false;
  return patrons(state, a).some((p) => patrons(state, b).some((q) => atWar(state, p, q)));
}

/** Land units may attack from `a` into `b`: next to each other, over a hexside that is land on both sides or a crossing arrow, never Qattara (Ref 4.6, 4.51). */
export function crossable(ctx: GameContext, a: HexId, b: HexId): boolean {
  if (!adjacent(hex(a), hex(b))) return false;
  const side = ctx.map.hexsides[hexsideId(hex(a), hex(b))];
  return side !== undefined && !side.qattara && (side.land || side.crossingArrow === true);
}

/** The ids of the map hexes next to `at`. */
export function neighborIds(ctx: GameContext, at: HexId): HexId[] {
  const out: HexId[] = [];
  for (const n of neighbors(hex(at))) {
    let id: HexId;
    try {
      id = hexId(n);
    } catch {
      continue;
    }
    if (ctx.map.hexes[id]) out.push(id);
  }
  return out;
}

/** Whether the owner's units fight at all: a Major Power must be in the war; a minor force (Poland, a Minor-Ally...) is. */
const takesPart = (state: GameState, o: ForceOwner): boolean => !isMajorPower(o) || inTheWar(state, o);

/** Ground units of the side that could attack now: on a hex, not yet used this turn, supplied. */
export function attackerPool(ctx: GameContext, state: GameState, side: Side, used: readonly string[]): Unit[] {
  return Object.values(state.units).filter(
    (u) => isGroundCombatUnit(u) && sideOfOwner(u.owner) === side && takesPart(state, u.owner) && ctx.map.hexes[u.at] !== undefined && !used.includes(u.id) && isSupplied(ctx, state, u),
  );
}

/** The ground units in a hex that at least one of the attackers is at war with. */
export const defendersAt = (state: GameState, attackers: readonly Unit[], at: HexId): Unit[] =>
  Object.values(state.units).filter((u) => u.at === at && isGroundCombatUnit(u) && attackers.some((a) => isEnemy(state, a.owner, u.owner)));

export interface AttackNumbers {
  attackFactors: number;
  defenseFactors: number;
  multiplier: number;
  column: OddsColumn | null;
}

/** The odds of an attack by `attackers` on `target` with its `defenders`, for the player to see before the roll (Ref 12.1, 4.5). */
export function attackNumbers(ctx: GameContext, state: GameState, attackers: readonly Unit[], defenders: readonly Unit[], target: HexId): AttackNumbers {
  const h = ctx.map.hexes[target]!;
  const behind = attackers.every((a) => {
    const side = ctx.map.hexsides[hexsideId(hex(a.at), hex(target))];
    return side !== undefined && (side.river === true || side.crossingArrow === true);
  });
  const multiplier = defenseMultiplier({ terrain: h.land ?? "plain", features: h.features, fortress: state.fortresses[target] === true, behindRiverOrArrow: behind });
  const attackFactors = attackers.reduce((n, u) => n + u.strength, 0);
  const defenseFactors = defenders.reduce((n, u) => n + u.strength, 0);
  return { attackFactors, defenseFactors, multiplier, column: oddsColumn(attackFactors, defenseFactors * multiplier) };
}
