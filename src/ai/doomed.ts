import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { unsuppliedUnits } from "../engine/supply";
import { wasCutOff } from "../engine/supply-effects";
import type { GameState, Side } from "../engine/types";
import { supplyRulesOn } from "./lines";
import type { AiConfig, Decision } from "./types";

/**
 * Units that are lost anyway (computer policy, spec 05, TODO(verify) by play-testing; acts only while the supply effects are on and
 * `AiConfig.supplyRules` is not false). A unit of the side to move that was cut off when its Player Turn began and is still cut off is eliminated
 * when the turn ends (Ref 19.4, 11.74), unless a line opens first; it cannot advance after combat (Ref 12.21) but attacks at full strength (19.4).
 * So the computer spends such units first:
 * - LOSSES_CUT_OFF_FIRST: when the side to move must choose Exchange losses (Ref 12.2), it picks, among the sets the engine offers, the one with
 *   the most factors of doomed units (`isDoomed`), the first listed on a tie, as before. A unit cut off only now is not doomed: it survives the
 *   turn (ELIMINATE_ONLY_IF_CUT_OFF_AT_START) and may be reconnected, so it counts like any other. When the other side chooses (its units
 *   defended), none of its units is doomed this turn, so it takes the first set listed.
 * - ATTACK_DOOMED_IGNORE_EXCHANGE: an attack made only by doomed units is not held back by the Exchange limit (assault.ts): whatever an Exchange
 *   takes from them, the end of the turn would take anyway. The odds floor still applies.
 */
export const LOSSES_CUT_OFF_FIRST = true;
export const ATTACK_DOOMED_IGNORE_EXCHANGE = true;

const cut = new WeakMap<GameContext, WeakMap<GameState, Map<Side, ReadonlySet<string>>>>();

/** The side's checked units with no supply line now (the engine's `unsuppliedUnits`), found once per context and position. */
export function cutOffNow(ctx: GameContext, state: GameState, side: Side): ReadonlySet<string> {
  let byState = cut.get(ctx);
  if (!byState) cut.set(ctx, (byState = new WeakMap<GameState, Map<Side, ReadonlySet<string>>>()));
  let bySide = byState.get(state);
  if (!bySide) byState.set(state, (bySide = new Map<Side, ReadonlySet<string>>()));
  let hit = bySide.get(side);
  if (!hit) bySide.set(side, (hit = new Set(unsuppliedUnits(ctx, state, side))));
  return hit;
}

/** Whether this unit of the side to move was cut off when the turn began and still is: it is eliminated when the turn ends unless a line opens. */
export const isDoomed = (ctx: GameContext, state: GameState, unitId: string): boolean => wasCutOff(state, unitId) && cutOffNow(ctx, state, state.activeSide).has(unitId);

/** Whether an attack by these units may skip the Exchange limit (ATTACK_DOOMED_IGNORE_EXCHANGE). */
export const exchangeFree = (ctx: GameContext, state: GameState, unitIds: readonly string[], cfg: AiConfig): boolean =>
  ATTACK_DOOMED_IGNORE_EXCHANGE && supplyRulesOn(ctx, cfg) && unitIds.length > 0 && unitIds.every((id) => isDoomed(ctx, state, id));

type Allocation = Extract<Action, { type: "ALLOCATE_LOSSES" }>;

/** An Exchange waits for the computer's losses: the set with the most factors of doomed units (LOSSES_CUT_OFF_FIRST), otherwise the first listed. */
export function chooseLosses(ctx: GameContext, state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  const sets = legal.filter((a): a is Allocation => a.type === "ALLOCATE_LOSSES");
  if (sets.length === 0) return undefined;
  if (!LOSSES_CUT_OFF_FIRST || !supplyRulesOn(ctx, cfg)) return { action: sets[0]!, why: "Loses the first legal set of units to the Exchange." };
  // Only the side to move has doomed units (the record of who was cut off is its own), so for the defending side every set counts 0.
  const spent = (a: Allocation) => a.units.filter((id) => isDoomed(ctx, state, id)).reduce((n, id) => n + (state.units[id]?.strength ?? 0), 0);
  let pick = sets[0]!;
  for (const a of sets) if (spent(a) > spent(pick)) pick = a;
  return { action: pick, why: spent(pick) > 0 ? "Loses to the Exchange the set with the most units cut off since the turn began, which its end would eliminate anyway." : "Loses the first legal set of units to the Exchange." };
}
