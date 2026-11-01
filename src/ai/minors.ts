import type { GameContext } from "../engine/context";
import { declarationCost, minorDeclarationProblem } from "../engine/minors-declare";
import { MC3_ONLY_DECLARERS_UNITS } from "../engine/minors-duty";
import { MINOR_COUNTRIES } from "../engine/minors-rules";
import { endProblem, movableProblem, reachableHexes } from "../engine/movement";
import type { GameState, GameTurn, MinorCountry, PowerId } from "../engine/types";
import { sideOfOwner } from "../engine/setup";
import { turnIndex } from "../engine/game";
import { atWar, sideOfPower } from "../engine/war";
import { adjacentHexes, canCross } from "../engine/zoc";

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
