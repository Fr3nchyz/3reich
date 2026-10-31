import { attackerPool, attackHexAllowed, crossable, isEnemy, isGroundCombatUnit, neighborIds } from "./attack-rules";
import { openBreakthrough } from "./breakthrough";
import { combatOf } from "./combat-record";
import { controllerOf } from "./control";
import type { GameContext } from "./context";
import { exploitOf, exploiterIds, type BreakthroughGroup } from "./exploit-record";
import { frontOptionOf } from "./frontoptions";
import type { HexId } from "./hex";
import { isUnitSupplied, supplyNetwork } from "./supply";
import type { GameState, Side } from "./types";

// spec 16 R16, TODO(verify) AER20: conservative vacancy includes every enemy counter.
export const VACANT_ALL_ENEMY_COUNTERS_BLOCK = true;
// spec 16 R16, TODO(verify) AER20: adjacency for the ban includes impassable hexsides.
export const VACANT_BAN_GEOMETRIC_ADJACENCY = true;
// spec 16 R16, TODO(verify) AER20: require an actual land line, not fortress or sea supply.
export const VACANT_REQUIRE_LAND_LINE = true;
// spec 16 R16, TODO(verify) AER20: only the initiating armor advances; companions stay.
export const VACANT_ONLY_INITIATOR_ADVANCES = true;

/** spec 16 R16: ids name an initiating armor first, followed by optional ground companions. No step/action wiring. */
export function vacantHexAttackProblem(ctx: GameContext, state: GameState, side: Side, units: readonly string[], target: HexId): string | null {
  if (side !== state.activeSide) return "Only the Phasing side may make a vacant-hex attack (R16).";
  const rec = combatOf(state);
  if (rec.pending) return "Choose the pending Exchange losses first (R16).";
  if (units.length === 0 || new Set(units).size !== units.length) return "Name distinct attackers with an initiating armor first (R16).";
  const h = ctx.map.hexes[target];
  if (!h?.land) return "The target must be a land hex (R16).";
  if (frontOptionOf(state, h.front) !== "offensive") return "The target Front needs the Offensive Option (R16).";
  if (!attackHexAllowed(rec.targets, target)) return "The hex has already been attacked (R16/AER20).";
  const pool = attackerPool(ctx, state, side, [...rec.attacked, ...exploiterIds(state)]);
  if (units.some((id) => !pool.some((u) => u.id === id))) return "Each attacker must be an unused, non-exploiting ground unit of this side (R16).";
  const initiator = state.units[units[0]!]!;
  if (initiator.type !== "armor") return "The initiating unit must be armor (R16).";
  if (!isUnitSupplied(ctx, state, initiator.id)) return "The initiating armor must be supplied (R16).";
  if (units.some((id) => !crossable(ctx, state.units[id]!.at, target))) return "Every attacker must be adjacent across a ground-crossable hexside (R16/AER20).";
  const owner = controllerOf(ctx, state, target);
  if (!owner || units.some((id) => !isEnemy(state, state.units[id]!.owner, owner))) return "The target must be enemy-controlled for every attacker (R16).";
  const occupied = Object.values(state.units).some((u) => u.at === target && units.some((id) => isEnemy(state, state.units[id]!.owner, u.owner)) && (VACANT_ALL_ENEMY_COUNTERS_BLOCK || ["infantry", "armor", "airborne"].includes(u.type)));
  return occupied ? "The target is not vacant (R16/AER20)." : null;
}

/** spec 16 R16: sorted legal targets, with at least one supplied initiating armor. */
export function vacantHexTargets(ctx: GameContext, state: GameState, side: Side): HexId[] {
  const pool = attackerPool(ctx, state, side, [...combatOf(state).attacked, ...exploiterIds(state)]).filter((u) => u.type === "armor");
  const candidates = new Set(pool.flatMap((u) => neighborIds(ctx, u.at)));
  return [...candidates].sort().filter((t) => pool.some((u) => vacantHexAttackProblem(ctx, state, side, [u.id], t) === null));
}

/**
 * spec 16 R16: immutable plan for later wiring. All participants are used and the target attacked;
 * only the first armor advances (AER20). A null group means the attack is legal but permits no
 * Exploitation. No control, capture, move, combat or ExploitRecord is written into the input.
 */
export function vacantHexAttackPlan(ctx: GameContext, state: GameState, side: Side, ids: readonly string[], target: HexId): { attacked: string[]; target: HexId; advancing: string[]; breakthrough: BreakthroughGroup | null } | null {
  if (vacantHexAttackProblem(ctx, state, side, ids, target)) return null;
  const armor = state.units[ids[0]!]!;
  const advancing = VACANT_ONLY_INITIATOR_ADVANCES ? [armor.id] : [...ids];
  const units = { ...state.units };
  for (const id of advancing) units[id] = { ...units[id]!, at: target };
  const rec = combatOf(state);
  const after: GameState = { ...state, units, control: { ...state.control, [target]: armor.owner }, combat: { ...rec, attacked: [...rec.attacked, ...ids], targets: [...rec.targets, target] } };
  const adjacentEnemy = Object.values(state.units).some((u) => isGroundCombatUnit(u) && isEnemy(state, armor.owner, u.owner) && (VACANT_BAN_GEOMETRIC_ADJACENCY ? neighborIds(ctx, target).includes(u.at) : crossable(ctx, target, u.at)));
  const line = VACANT_REQUIRE_LAND_LINE
    ? supplyNetwork(ctx, after, side).reaches.some((r) => r.kind !== "sea" && r.serves(armor.owner) && r.next.has(target))
    : isUnitSupplied(ctx, after, armor.id);
  const opened = adjacentEnemy || !line ? null : openBreakthrough(ctx, after, { to: target, units: [...ids], armor: true, from: [...new Set(ids.map((id) => state.units[id]!.at))] });
  return { attacked: [...ids], target, advancing, breakthrough: opened ? exploitOf(opened.state).groups.at(-1)! : null };
}
