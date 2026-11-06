import type { GameContext } from "../engine/context";
import { declarationCost, minorDeclarationProblem } from "../engine/minors-declare";
import { MC3_ONLY_DECLARERS_UNITS } from "../engine/minors-duty";
import { MINOR_COUNTRIES } from "../engine/minors-rules";
import type { Action } from "../engine/actions";
import { sideInWar } from "../engine/control";
import { fightingRecord } from "../engine/minors-intervene";
import { endProblem, movableProblem, movableUnits, reachableHexes } from "../engine/movement";
import type { GameState, GameTurn, MinorCountry, PowerId, Unit } from "../engine/types";
import { AI_INTERVENES_IN_ATTACKED_MINORS } from "./policies";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";
import { sideOfOwner } from "../engine/setup";
import { turnIndex } from "../engine/game";
import { atWar, sideOfPower } from "../engine/war";
import { adjacentHexes, canCross, enemyZocFor } from "../engine/zoc";

export interface MinorPlan {
  readonly by: PowerId;
  readonly on: MinorCountry;
  readonly from: Readonly<GameTurn>;
}

/** TODO(verify) MC30, spec 15 Part E (R4 duty): policy dates and priority use the listed order. */
export const MC30_MINOR_PLAN_ORDER = ["denmark", "norway", "netherlands", "belgium", "luxembourg", "yugoslavia", "greece"] as const;
export const MC30_EARLY_MINOR_TURN = { year: 1940, season: "spring" } as const;
export const MC30_BALKAN_MINOR_TURN = { year: 1941, season: "spring" } as const;
export const MINOR_PLANS: readonly MinorPlan[] = MC30_MINOR_PLAN_ORDER.map((on) => ({
  by: "germany", on, from: on === "yugoslavia" || on === "greece" ? MC30_BALKAN_MINOR_TURN : MC30_EARLY_MINOR_TURN,
}));

/** TODO(verify) MC31, spec 15 Part E / R4: require movable ground units and crossable attack adjacency.
 * One-move reach uses the engine after a hypothetical declaration; it predicts reach, not combat success.
 */
export const MC31_REQUIRE_CROSSABLE_ADJACENCY = true;

/** Spec 15 Part E / R4, MC3: only the declaring nation's units can meet its duty. No state is changed. */
export function dutyFeasible(ctx: GameContext, state: GameState, by: PowerId, on: MinorCountry): boolean {
  if (!MINOR_COUNTRIES.includes(on)) return false;
  const nation = state.nations[by];
  if (!nation || sideOfPower(nation) === null) return false;
  // R2/R4: open the target only in this local projection; placement remains the future caller's job.
  const projected: GameState = { ...state, activeSide: sideOfPower(nation)!,
    wars: atWar(state, by, on) ? state.wars : [...state.wars, [by, on]],
    countries: { ...state.countries, [on]: { ...state.countries?.[on], status: "attacked", attacker: by } },
  };
  for (const unit of Object.values(state.units)) {
    if (MC3_ONLY_DECLARERS_UNITS ? unit.owner !== by : unit.owner !== by && sideOfOwner(unit.owner) !== sideOfPower(nation)) continue;
    if (movableProblem(ctx, projected, unit) !== null) continue;
    if (adjacentHexes(ctx, unit.at).some((hex) => ctx.map.hexes[hex]?.country === on &&
      (!MC31_REQUIRE_CROSSABLE_ADJACENCY || canCross(ctx, unit.at, hex)))) return true;
    for (const hex of reachableHexes(ctx, projected, [unit]).keys()) {
      if (ctx.map.hexes[hex]?.country === on && endProblem(ctx, projected, [unit], hex) === null) return true;
    }
  }
  return false;
}

/** TODO(verify) MC32, spec 15 Part E / R2: reserve all pending plans, even before their date or outside reach.
 * Each must fit the full yearly spending limit; reserve is not capped by cash or remaining spending.
 */
export const MC32_RESERVE_FUTURE_PLANS = true;

/** Spec 15 Part E: minor-only reserve, additive to the existing major-power reserve when wired later. */
export function plannedReserve(ctx: GameContext, state: GameState, by: PowerId): number {
  const nation = state.nations[by];
  if (!nation || sideOfPower(nation) === null) return 0;
  return MINOR_PLANS.filter((plan) => plan.by === by && !atWar(state, by, plan.on) &&
    minorDeclarationProblem(ctx, state, by, plan.on) === null &&
    (MC32_RESERVE_FUTURE_PLANS || turnIndex(state) >= turnIndex(plan.from)))
    .reduce((sum, plan) => {
      const cost = declarationCost(ctx, state, by, plan.on);
      return sum + (cost <= nation.spendLimit ? cost : 0);
    }, 0);
}

const GROUND = ["infantry", "armor", "airborne", "replacement"];

/**
 * Spec 15 R6, Q4, ticket 15-17 (policy AI_INTERVENES_IN_ATTACKED_MINORS, TODO(verify) MC33): the active side's mover Intervenes in an attacked, unconquered minor that fights on its side
 * and has no helper of this side yet. The stacks are the unmoved ground units of Major Powers of the side (a minor's own units never leave home, R8); the move is any the engine allows
 * that ends in a hex of the minor. The biggest stack goes (ties: the seed), the minors are taken in the engine's list order. Returns undefined when there is nothing to do.
 */
export function chooseIntervention(ctx: GameContext, state: GameState, cfg: AiConfig): Decision | undefined {
  if (!AI_INTERVENES_IN_ATTACKED_MINORS) return undefined;
  const side = state.activeSide;
  const zoc = enemyZocFor(ctx, state, side);
  const mine = movableUnits(ctx, state).filter((u) => GROUND.includes(u.type) && Object.hasOwn(state.nations, u.owner) && sideInWar(state, u.owner) === side);
  if (mine.length === 0) return undefined;
  const groups = new Map<string, Unit[]>();
  for (const u of mine) groups.set(u.at, [...(groups.get(u.at) ?? []), u]);
  for (const minor of MINOR_COUNTRIES) {
    const record = fightingRecord(state, minor);
    if (!record || sideInWar(state, minor) !== side || record.attacker === undefined) continue;
    if (record.helpers?.some((h) => sideInWar(state, h) === side)) continue; // already helped by this side
    const candidates: { action: Extract<Action, { type: "MOVE" }>; units: Unit[]; to: string }[] = [];
    for (const [, units] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
      for (const set of units.length > 1 ? [...units.map((u) => [u]), units] : [units]) {
        for (const [to, path] of [...reachableHexes(ctx, state, set, zoc)].sort(([a], [b]) => (a < b ? -1 : 1))) {
          if (ctx.map.hexes[to]?.country !== minor || endProblem(ctx, state, set, to) !== null) continue;
          candidates.push({ action: { type: "MOVE", side, units: set.map((u) => u.id), path }, units: set, to });
        }
      }
    }
    if (candidates.length === 0) continue;
    const pick = best(candidates, (c) => c.units.reduce((n, u) => n + u.strength, 0), cfg.seed, (c) => `${c.action.units.join(",")}>${c.to}`)!;
    const who = pick.units.length === 1 ? "a unit" : `${pick.units.length} units`;
    return { action: pick.action, why: `Intervenes in ${minor}, attacked by ${record.attacker}: moves ${who} from ${pick.units[0]!.at} to ${pick.to} to help it (spec 15 R6, Q4).` };
  }
  return undefined;
}
