import type { Action } from "../engine/actions";
import { controllingSide, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import { movesOf } from "../engine/move-record";
import { neighborIds } from "../engine/attack-rules";
import { GROUND_MOVERS } from "../engine/movement";
import type { ForceOwner, GameState, Unit } from "../engine/types";
import { distanceToEnemyObjective, isObjective } from "./geo";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * Step 6f, ground movement. COMPUTER POLICY, not rules (spec 05; every number is TODO(verify), to be tuned by play-testing).
 * Of the MOVE actions the engine lists it takes the one that brings a stack closest to the nearest enemy-held capital or
 * objective (hexes of ground movement, see geo.ts), if that is at least MOVE_MIN_PROGRESS hexes closer; ties go to the
 * larger stack, then to the seed. It keeps a garrison on its own capital, does not end next to enemy ground factors worth
 * more than MOVE_MAX_ENEMY_RATIO times its own there, and stops after MOVE_MAX_UNITS_PER_TURN units have moved. When no
 * move qualifies it ends the step. Supply is not considered (TODO(verify): cheap to add once supply is a rule).
 */
export const MOVE_MIN_PROGRESS = 1;
export const MOVE_MAX_UNITS_PER_TURN = 40;
export const MOVE_MAX_ENEMY_RATIO = 2;
export const MOVE_KEEP_CAPITAL_GARRISON = true;

type Move = Extract<Action, { type: "MOVE" }>;

const isGround = (u: Unit): boolean => GROUND_MOVERS.includes(u.type) || u.type === "replacement";

export function chooseMove(ctx: GameContext, state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  if (movesOf(state).moved.length >= MOVE_MAX_UNITS_PER_TURN) return undefined;
  const moves = legal.filter((a): a is Move => a.type === "MOVE");
  if (moves.length === 0) return undefined;
  const side = state.activeSide;

  const at = new Map<string, Unit[]>();
  for (const u of Object.values(state.units)) if (isGround(u)) at.set(u.at, [...(at.get(u.at) ?? []), u]);
  const factors = (us: readonly Unit[] | undefined) => (us ?? []).reduce((n, u) => n + u.strength, 0);
  const fields = new Map<ForceOwner, Map<string, number>>();
  const fieldOf = (owner: ForceOwner) => fields.get(owner) ?? fields.set(owner, distanceToEnemyObjective(ctx, state, owner, side)).get(owner)!;
  const exposed = new Map<string, number>();
  const enemyNear = (hex: string): number => exposed.get(hex) ?? exposed.set(hex, neighborIds(ctx, hex).reduce((n, h) => n + factors((at.get(h) ?? []).filter((u) => { const s = sideInWar(state, u.owner); return s !== null && s !== side; })), 0)).get(hex)!;

  const progress = new Map<Move, number>();
  for (const m of moves) {
    const units = m.units.map((id) => state.units[id]!);
    const from = units[0]!.at;
    const to = m.path[m.path.length - 1]!;
    const field = fieldOf(units[0]!.owner);
    const [d0, d1] = [field.get(from), field.get(to)];
    if (d0 === undefined || d1 === undefined || d0 - d1 < MOVE_MIN_PROGRESS) continue;
    // A garrison stays on the capital of its own side.
    const features = ctx.map.hexes[from]?.features ?? [];
    const holds = (features.includes("capital") || features.includes("capital-port")) && controllingSide(ctx, state, from) === side;
    if (MOVE_KEEP_CAPITAL_GARRISON && holds && (at.get(from) ?? []).every((u) => m.units.includes(u.id) || sideInWar(state, u.owner) !== side)) continue;
    const mine = factors(at.get(to)) + factors(units);
    if (enemyNear(to) > MOVE_MAX_ENEMY_RATIO * mine) continue;
    progress.set(m, d0 - d1);
  }
  const score = (m: Move) => progress.get(m)! * 100 + m.units.length * 10 + (isObjective(ctx, m.path[m.path.length - 1]!) ? 5 : 0);
  const pick = best([...progress.keys()], score, cfg.seed, (m) => `${m.units.join(",")}>${m.path[m.path.length - 1]}`);
  if (!pick) return undefined;
  const to = pick.path[pick.path.length - 1]!;
  const from = state.units[pick.units[0]!]!.at;
  const left = fieldOf(state.units[pick.units[0]!]!.owner).get(to)!;
  return { action: pick, why: `Moves ${pick.units.length === 1 ? "a unit" : `${pick.units.length} units`} from ${from} to ${to}, ${progress.get(pick)} hex${progress.get(pick) === 1 ? "" : "es"} closer to the nearest enemy-held objective (${left} to go).` };
}
