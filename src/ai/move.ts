import type { Action } from "../engine/actions";
import { controllingSide, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import { neighborIds } from "../engine/attack-rules";
import { turnIndex } from "../engine/game";
import type { HexId } from "../engine/hex";
import { movesOf } from "../engine/move-record";
import { endProblem, movableUnits, reachableHexes } from "../engine/movement";
import type { GameState, Unit } from "../engine/types";
import { enemyZocFor } from "../engine/zoc";
import { distanceToEnemyObjective, enemyObjectives, groundDistances, isObjective, stagingTargets } from "./geo";
import type { AiMemory } from "./memory";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * Step 6f, ground movement. COMPUTER POLICY, not rules (spec 05; every number is TODO(verify), to be tuned by play-testing).
 * Stacks are taken one after another, the ones nearest their target first (they free the hexes the ones behind move into, and
 * they are the ones the cap on units moved must not leave out). Each unit heads for one enemy-held capital or
 * objective, the nearest when it first looks and the same one afterwards until it is reached or lost (so units do not dither
 * between two). A stack takes the move, among those the engine allows it (the cheapest route to each reachable hex, as in
 * `legalActions`), that brings it closest to that target, at least MOVE_MIN_PROGRESS hexes closer; ties go to the larger stack,
 * then to the seed. It does not go back to a hex it left in the last MOVE_NO_RETURN_TURNS Game Turns, keeps a garrison on its
 * own capital, does not end next to enemy ground factors worth more than MOVE_MAX_ENEMY_RATIO times its own there, and stops
 * after MOVE_MAX_UNITS_PER_TURN units have moved. Only the stacks looked at are searched, so a decision costs a few
 * milliseconds, not the whole move list. A stack with no way to any enemy objective (they lie behind a neutral country's land, a sea or
 * a closed border) does not stand still: it heads for the capitals and objectives of a neutral Major Power the computer plans to declare
 * war on (`plannedTargets` in declare.ts), counting that country's land as open, so it waits at the border for the declaration; the
 * engine still lets it move only where it may enter now. When no stack qualifies it ends the step. Supply is not considered.
 */
export const MOVE_MIN_PROGRESS = 1;
export const MOVE_MAX_UNITS_PER_TURN = 80;
export const MOVE_MAX_ENEMY_RATIO = 2;
export const MOVE_KEEP_CAPITAL_GARRISON = true;
export const MOVE_NO_RETURN_TURNS = 2;

type Move = Extract<Action, { type: "MOVE" }>;
const isGround = (u: Unit): boolean => ["infantry", "armor", "airborne", "replacement"].includes(u.type);

/** Where a unit is heading: its remembered target while the enemy still holds it, otherwise the nearest enemy objective (remembered from then on). */
function targetOf(u: Unit, nearest: Map<HexId, HexId>, held: ReadonlySet<HexId>, mem: AiMemory | undefined): HexId | undefined {
  const kept = mem?.targets.get(u.id);
  if (kept !== undefined && held.has(kept) && kept !== u.at) return kept;
  return nearest.get(u.at);
}

export function chooseMove(ctx: GameContext, state: GameState, cfg: AiConfig): Decision | undefined {
  if (movesOf(state).moved.length >= MOVE_MAX_UNITS_PER_TURN) return undefined;
  const side = state.activeSide;
  const mem = cfg.memory;
  const turn = turnIndex(state);
  if (mem && mem.distancesTurn !== turn) {
    mem.distances.clear();
    mem.nearest.clear();
    mem.staging.clear();
    mem.distancesTurn = turn;
  }
  const zoc = enemyZocFor(ctx, state, side);
  const held = new Set(enemyObjectives(ctx, state, side));
  const at = new Map<string, Unit[]>();
  for (const u of Object.values(state.units)) if (isGround(u)) at.set(u.at, [...(at.get(u.at) ?? []), u]);
  const factors = (us: readonly Unit[] | undefined) => (us ?? []).reduce((n, u) => n + u.strength, 0);
  const exposed = new Map<string, number>();
  const enemyNear = (hex: string): number =>
    exposed.get(hex) ?? exposed.set(hex, neighborIds(ctx, hex).reduce((n, h) => n + factors((at.get(h) ?? []).filter((u) => { const s = sideInWar(state, u.owner); return s !== null && s !== side; })), 0)).get(hex)!;

  // Per owner: the nearest enemy objective of every hex; per (owner, target): the distance to it.
  // Kept in the memory for the Game Turn while the set of enemy-held objectives stays the same (a capture changes the key).
  const nearestBy = mem?.nearest ?? new Map<string, { dist: Map<HexId, number>; from: Map<HexId, HexId> }>();
  const heldKey = [...held].join(",");
  const nearestFor = (owner: string) => {
    const key = `${owner}|${heldKey}`;
    let hit = nearestBy.get(key);
    if (!hit) {
      const from = new Map<HexId, HexId>();
      hit = { dist: distanceToEnemyObjective(ctx, state, owner as Unit["owner"], side, from), from };
      nearestBy.set(key, hit);
    }
    return hit;
  };
  // Where a unit with no way to an enemy objective waits: the nearest objective of a country the computer plans to declare war on.
  let staging: ReturnType<typeof stagingTargets> | undefined;
  const stagingBy = mem?.staging ?? new Map<string, { dist: Map<HexId, number>; from: Map<HexId, HexId> }>();
  const stageFor = (owner: string) => {
    staging ??= stagingTargets(ctx, state, side);
    const key = `${owner}|${staging.sources.join(",")}|${[...staging.open].join(",")}`;
    let hit = stagingBy.get(key);
    if (!hit) {
      const from = new Map<HexId, HexId>();
      hit = { dist: groundDistances(ctx, state, owner as Unit["owner"], staging.sources, from, staging.open), from };
      stagingBy.set(key, hit);
    }
    return hit;
  };
  const distanceTo = (owner: Unit["owner"], target: HexId): Map<HexId, number> => {
    const key = `${owner}>${target}`;
    const kept = mem?.distances.get(key);
    if (kept) return kept;
    const d = groundDistances(ctx, state, owner, [target]);
    mem?.distances.set(key, d);
    return d;
  };

  // The groups of unmoved ground units standing together, with where each is heading, the farthest from it first.
  const groups = new Map<string, Unit[]>();
  for (const u of movableUnits(ctx, state)) groups.set(u.at, [...(groups.get(u.at) ?? []), u]);
  const work: { units: Unit[]; target: HexId; d0: number; field: Map<HexId, number>; staged: boolean }[] = [];
  for (const [hex, units] of groups) {
    const owner = units[0]!.owner;
    const near = nearestFor(owner);
    const target = targetOf(units[0]!, near.from, held, mem);
    const field = target === undefined ? undefined : target === near.from.get(hex) ? near.dist : distanceTo(owner, target);
    const d0 = field?.get(hex);
    if (target !== undefined && field && d0 !== undefined) {
      if (d0 > 0) work.push({ units, target, d0, field, staged: false });
      continue;
    }
    const wait = stageFor(owner);
    const place = wait.from.get(hex);
    const dw = wait.dist.get(hex);
    if (place !== undefined && dw !== undefined && dw > 0) work.push({ units, target: place, d0: dw, field: wait.dist, staged: true });
  }
  work.sort((a, b) => b.d0 - a.d0 || (a.units[0]!.at < b.units[0]!.at ? -1 : 1));

  for (const { units, target, d0, field, staged } of work) {
    const from = units[0]!.at;
    const features = ctx.map.hexes[from]?.features ?? [];
    const holds = (features.includes("capital") || features.includes("capital-port")) && controllingSide(ctx, state, from) === side;
    const candidates: { move: Move; progress: number }[] = [];
    for (const set of units.length > 1 ? [...units.map((u) => [u]), units] : [units]) {
      // A garrison stays on the capital of its own side: the whole stack leaving would empty it.
      if (MOVE_KEEP_CAPITAL_GARRISON && holds && set.length === (at.get(from) ?? []).filter((u) => sideInWar(state, u.owner) === side).length) continue;
      for (const [to, path] of [...reachableHexes(ctx, state, set, zoc)].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const d1 = field.get(to);
        if (d1 === undefined || d0 - d1 < MOVE_MIN_PROGRESS || endProblem(ctx, state, set, to) !== null) continue;
        if (set.some((u) => (mem?.left.get(u.id) ?? []).some((l) => l.hex === to && turn - l.turn < MOVE_NO_RETURN_TURNS))) continue;
        if (enemyNear(to) > MOVE_MAX_ENEMY_RATIO * (factors(at.get(to)) + factors(set))) continue;
        candidates.push({ move: { type: "MOVE", side, units: set.map((u) => u.id), path }, progress: d0 - d1 });
      }
    }
    if (candidates.length === 0) continue;
    const score = (c: { move: Move; progress: number }) => c.progress * 100 + c.move.units.length * 10 + (isObjective(ctx, c.move.path[c.move.path.length - 1]!) ? 5 : 0);
    const pick = best(candidates, score, cfg.seed, (c) => `${c.move.units.join(",")}>${c.move.path[c.move.path.length - 1]}`)!;
    if (mem) {
      for (const id of pick.move.units) {
        if (!staged) mem.targets.set(id, target);
        mem.left.set(id, [...(mem.left.get(id) ?? []).filter((l) => turn - l.turn < MOVE_NO_RETURN_TURNS), { hex: from, turn }]);
      }
    }
    const to = pick.move.path[pick.move.path.length - 1]!;
    const left = d0 - pick.progress;
    const who = pick.move.units.length === 1 ? "a unit" : `${pick.move.units.length} units`;
    const near = `${pick.progress} hex${pick.progress === 1 ? "" : "es"} closer to`;
    return { action: pick.move, why: staged ? `Moves ${who} from ${from} to ${to}, ${near} ${target} (${left} to go), an objective of a power it plans to declare war on: no enemy objective is within reach, so it waits at the border.` : `Moves ${who} from ${from} to ${to}, ${near} the enemy-held objective ${target} (${left} to go).` };
  }
  return undefined;
}
