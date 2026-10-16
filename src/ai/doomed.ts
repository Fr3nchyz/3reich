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
 * - LOSSES_CUT_OFF_FIRST: when it must choose Exchange losses (Ref 12.2), it picks, among the sets the engine offers, the one with the most
 *   factors of its units that are out of supply now (for the side to move these are lost at the end of its turn if still cut off; for the other
 *   side they will be checked when its turn begins), the first listed on a tie, as before.
 * - ATTACK_DOOMED_IGNORE_EXCHANGE: an attack made only by doomed units is not held back by the Exchange limit (assault.ts): whatever an Exchange
 *   takes from them, the end of the turn would take anyway. The odds floor still applies.
 */
export const LOSSES_CUT_OFF_FIRST = true;
export const ATTACK_DOOMED_IGNORE_EXCHANGE = true;

const cut = new WeakMap<GameState, Map<Side, ReadonlySet<string>>>();

/** The side's checked units with no supply line now (the engine's `unsuppliedUnits`), found once per position. */
export function cutOffNow(ctx: GameContext, state: GameState, side: Side): ReadonlySet<string> {
  let bySide = cut.get(state);
  if (!bySide) cut.set(state, (bySide = new Map<Side, ReadonlySet<string>>()));
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

/** An Exchange waits for the computer's losses: the set with the most factors of units out of supply (LOSSES_CUT_OFF_FIRST), otherwise the first listed. */
export function chooseLosses(ctx: GameContext, state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  const sets = legal.filter((a): a is Allocation => a.type === "ALLOCATE_LOSSES");
  if (sets.length === 0) return undefined;
  if (!LOSSES_CUT_OFF_FIRST || !supplyRulesOn(ctx, cfg)) return { action: sets[0]!, why: "Loses the first legal set of units to the Exchange." };
  const cutOff = cutOffNow(ctx, state, sets[0]!.side);
  const spent = (a: Allocation) => a.units.filter((id) => cutOff.has(id)).reduce((n, id) => n + (state.units[id]?.strength ?? 0), 0);
  let pick = sets[0]!;
  for (const a of sets) if (spent(a) > spent(pick)) pick = a;
  return { action: pick, why: spent(pick) > 0 ? "Loses to the Exchange the set with the most units out of supply, which the end of the turn may take anyway." : "Loses the first legal set of units to the Exchange." };
}
