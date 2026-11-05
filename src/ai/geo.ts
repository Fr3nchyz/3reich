import { crossable as attackCrossable, isGroundCombatUnit, neighborIds } from "../engine/attack-rules";
import { defenseMultiplier } from "../engine/terrain";
import { winterDefence } from "../engine/winter-effects";
import { combatOf } from "../engine/combat-record";
import { endProblem, movableUnits, movementFactor, reachableHexes } from "../engine/movement";
import type { Decision } from "./types";
import { controllerOf, controllingSide, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import type { HexId } from "../engine/hex";
import { MINOR_COUNTRY_FORCES } from "../engine/tables";
import type { HexFeature } from "../engine/terrain";
import type { ForceOwner, GameState, Side, Unit } from "../engine/types";
import { atWar } from "../engine/war";
import { adjacentHexes, canCross } from "../engine/zoc";
import { plannedTargets } from "./declare";

/**
 * Where the computer wants its ground units to go (computer policy, not rules): toward the nearest hex of the enemy
 * that is worth taking. A distance is counted in hexes along ground hexsides a unit could cross, so a sea or a closed
 * border is never "close".
 * TODO(verify): the list of features that make a hex worth taking is the computer's own policy (spec 05).
 */
export const OBJECTIVE_FEATURES: readonly HexFeature[] = ["capital", "capital-port", "objective"];

const lists = new WeakMap<GameContext, HexId[]>();

/** The capitals and objective cities of the map, in hex order. */
export function objectiveHexes(ctx: GameContext): readonly HexId[] {
  let hit = lists.get(ctx);
  if (!hit) {
    hit = Object.values(ctx.map.hexes).filter((h) => h.land && h.features.some((f) => OBJECTIVE_FEATURES.includes(f))).map((h) => h.id).sort();
    lists.set(ctx, hit);
  }
  return hit;
}

/** Whether a hex is an objective or capital. */
export const isObjective = (ctx: GameContext, hex: HexId): boolean => ctx.map.hexes[hex]?.features.some((f) => OBJECTIVE_FEATURES.includes(f)) ?? false;

/**
 * Land the owner's units may not enter: a neutral country's, as movement.ts's entryProblem reads it (the units standing there
 * are left out). `open` names owners whose land is counted as open anyway (a country the computer plans to declare war on).
 */
function closedTo(ctx: GameContext, state: GameState, owner: ForceOwner, hex: HexId, open?: ReadonlySet<string>): boolean {
  const control = controllerOf(ctx, state, hex);
  if (control !== null) return control !== owner && sideInWar(state, control) === null && !atWar(state, owner, control) && !open?.has(control);
  const country = ctx.map.hexes[hex]?.country;
  return country !== undefined && Object.hasOwn(MINOR_COUNTRY_FORCES, country) && !atWar(state, owner, country as ForceOwner) && !open?.has(country);
}

/** Hexes of the enemy of `side` that are objectives or capitals and that it controls now, in hex order. */
export function enemyObjectives(ctx: GameContext, state: GameState, side: Side): HexId[] {
  return objectiveHexes(ctx).filter((h) => {
    const holder = controllingSide(ctx, state, h);
    return holder !== null && holder !== side;
  });
}

const crossings = new WeakMap<GameContext, Map<HexId, readonly HexId[]>>();

/** The hexes a ground unit could cross into from this one: fixed by the map, so worked out once per hex. */
function crossable(ctx: GameContext, here: HexId): readonly HexId[] {
  let map = crossings.get(ctx);
  if (!map) crossings.set(ctx, (map = new Map<HexId, readonly HexId[]>()));
  let hit = map.get(here);
  if (!hit) map.set(here, (hit = adjacentHexes(ctx, here).filter((n) => canCross(ctx, here, n))));
  return hit;
}

/** Breadth-first ground distance from the `sources` to every hex a unit of `owner` could reach on foot; with `from`, also the source each hex is nearest to (the first in the list on a tie). */
export function groundDistances(ctx: GameContext, state: GameState, owner: ForceOwner, sources: readonly HexId[], from?: Map<HexId, HexId>, open?: ReadonlySet<string>): Map<HexId, number> {
  const dist = new Map<HexId, number>();
  const shut = new Map<HexId, boolean>();
  const closed = (h: HexId): boolean => shut.get(h) ?? shut.set(h, closedTo(ctx, state, owner, h, open)).get(h)!;
  let frontier: HexId[] = [];
  for (const h of sources) {
    dist.set(h, 0);
    from?.set(h, h);
    frontier.push(h);
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: HexId[] = [];
    for (const here of frontier) {
      for (const n of crossable(ctx, here)) {
        if (dist.has(n) || closed(n)) continue;
        dist.set(n, d);
        from?.set(n, from.get(here)!);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * For every hex a unit of `owner` could reach on foot, the number of hexes to the nearest enemy-held objective or capital
 * (and, with `from`, which one). A hex missing from the map cannot reach any (a sea, an island, or land cut off by neutral country).
 */
export function distanceToEnemyObjective(ctx: GameContext, state: GameState, owner: ForceOwner, side: Side, from?: Map<HexId, HexId>): Map<HexId, number> {
  return groundDistances(ctx, state, owner, enemyObjectives(ctx, state, side), from);
}

/**
 * Where units with no way to any enemy objective can wait: the capitals and objectives of the neutral Major Powers the computer
 * plans to declare war on (`plannedTargets`), and those powers, whose land the staging distance counts as open. A unit that
 * heads there still moves only where the engine lets it now, so it stops at the border until the declaration is made.
 */
export function stagingTargets(ctx: GameContext, state: GameState, side: Side): { sources: HexId[]; open: Set<string> } {
  const open = new Set<string>(plannedTargets(state, side));
  return { sources: objectiveHexes(ctx).filter((h) => open.has(controllerOf(ctx, state, h) ?? "")), open };
}

/** TODO(verify) AER56, spec 05 Defend Berlin: recall before a plausible one-turn force exceeds local multiplied defence. */
export const CAPITAL_THREAT_RATIO = 1;
/** TODO(verify) AER57, spec 05 Defend Berlin: include the capital's immediate defensive ring. */
export const CAPITAL_DEFENSE_RADIUS = 1;

/** Public-board estimate like move.ts enemyNear, extended by printed movement over open ground; no dice or future orders. */
export function capitalThreat(ctx: GameContext, state: GameState, capital: HexId): { enemies: Unit[]; area: HexId[]; defense: number } {
  const area = [capital, ...(CAPITAL_DEFENSE_RADIUS > 0 ? neighborIds(ctx, capital).filter((h) => attackCrossable(ctx, capital, h)) : [])];
  const fields = new Map<string, Map<HexId, number>>();
  const enemies = Object.values(state.units).filter((u) => {
    const side = sideInWar(state, u.owner);
    if (!isGroundCombatUnit(u) || side === null || side === state.activeSide) return false;
    let field = fields.get(u.owner);
    if (!field) fields.set(u.owner, (field = groundDistances(ctx, state, u.owner, area)));
    return (field.get(u.at) ?? Infinity) <= movementFactor(u);
  });
  // Ref 4.5-4.9, 12.1, 28.0: reuse combat terrain/fortress/winter multipliers; future river approaches are unknown.
  const defense = area.reduce((n, h) => {
    const defenders = Object.values(state.units).filter((u) => u.at === h && isGroundCombatUnit(u) && sideInWar(state, u.owner) === state.activeSide);
    return n + defenseMultiplier({ terrain: ctx.map.hexes[h]!.land ?? "plain", fortress: state.fortresses[h] === true, winter: winterDefence(ctx, state, defenders, h) }) * defenders.reduce((v, u) => v + u.strength, 0);
  }, 0);
  return { enemies, area, defense };
}

/** Spec 05 Defend Berlin: a reserve must not open a new one-turn entry/attack route to any held objective. */
export function opensObjective(ctx: GameContext, state: GameState, unit: Unit): boolean {
  const objectives = objectiveHexes(ctx).filter((h) => controllingSide(ctx, state, h) === state.activeSide);
  const after = { ...state, units: { ...state.units } };
  delete after.units[unit.id];
  for (const enemy of Object.values(state.units)) {
    const side = sideInWar(state, enemy.owner);
    if (!isGroundCombatUnit(enemy) || side === null || side === state.activeSide || movementFactor(enemy) === 0) continue;
    // Only removing a last ground blocker can create an entry route (Ref 5.45f); friendly armor ZOC remains engine-owned.
    const beforeReach = reachableHexes(ctx, state, [enemy]);
    const afterReach = reachableHexes(ctx, after, [enemy]);
    const access = (reach: Map<HexId, HexId[]>, h: HexId) => reach.has(h) || neighborIds(ctx, h).some((n) => attackCrossable(ctx, n, h) && (n === enemy.at || reach.has(n)));
    if (objectives.some((h) => !access(beforeReach, h) && access(afterReach, h))) return true;
  }
  return false;
}

/** Spec 05 Defend Berlin, Ref 19.2: reinforce own Major Power capitals before ordinary advances. */
export function defendCapital(ctx: GameContext, state: GameState): Decision | undefined {
  const side = state.activeSide;
  const ground = Object.values(state.units).filter(isGroundCombatUnit);
  const used = combatOf(state).attacked;
  for (const capital of objectiveHexes(ctx)) {
    const h = ctx.map.hexes[capital]!;
    if (!h.features.some((f) => f === "capital" || f === "capital-port") || !h.country || !(h.country in state.nations) ||
      sideInWar(state, h.country as ForceOwner) !== side || controllingSide(ctx, state, capital) !== side) continue;
    const { enemies, area, defense } = capitalThreat(ctx, state, capital);
    if (enemies.reduce((n, u) => n + u.strength, 0) <= CAPITAL_THREAT_RATIO * defense) continue;
    const reserves = movableUnits(ctx, state).filter((u) => !area.includes(u.at) && !used.includes(u.id) &&
      !ground.some((e) => sideInWar(state, e.owner) !== null && sideInWar(state, e.owner) !== side && attackCrossable(ctx, u.at, e.at)));
    const candidates: { unit: Unit; to: HexId; path: HexId[]; multiplier: number }[] = [];
    for (const unit of reserves) {
      for (const [to, path] of reachableHexes(ctx, state, [unit])) {
        if (!area.includes(to) || endProblem(ctx, state, [unit], to) !== null) continue;
        const multiplier = defenseMultiplier({ terrain: ctx.map.hexes[to]!.land ?? "plain", fortress: state.fortresses[to] === true, winter: winterDefence(ctx, state, [{ ...unit, at: to }], to) });
        candidates.push({ unit, to, path, multiplier });
      }
    }
    // Nearest reserve first; prefer the capital, then the strongest adjacent terrain, with stable ties.
    candidates.sort((a, b) => a.path.length - b.path.length || Number(b.to === capital) - Number(a.to === capital) || b.multiplier - a.multiplier || a.unit.id.localeCompare(b.unit.id) || a.to.localeCompare(b.to));
    const checked = new Map<string, boolean>();
    for (const c of candidates) {
      if (!checked.has(c.unit.id)) checked.set(c.unit.id, opensObjective(ctx, state, c.unit));
      if (checked.get(c.unit.id)) continue;
      return { action: { type: "MOVE", side, units: [c.unit.id], path: c.path }, why: `Defends capital ${capital}: recalls ${c.unit.id} from ${c.unit.at} to ${c.to} against a one-turn ground threat.` };
    }
  }
  return undefined;
}
