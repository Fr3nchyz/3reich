import type { Action } from "../engine/actions";
import { isEnemy, isGroundCombatUnit } from "../engine/attack-rules";
import type { GameContext } from "../engine/context";
import { FRONTS, optionCost } from "../engine/frontoptions";
import type { Front } from "../engine/map";
import { distance, parseHexId, type Hex } from "../engine/hex";
import { sideOfOwner } from "../engine/setup";
import type { FrontOption, GameState, Unit } from "../engine/types";
import { plannedReserve } from "./declare";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * Step 3, the Front Options (spec 16 Part E, ticket 16-1). COMPUTER POLICY, not rules: it only picks among the SELECT_FRONT_OPTION actions the engine
 * lists (so the Russian winter ban, the cost and the payer are the engine's). Every number is a named constant, to be tuned by play-testing.
 * For each Front without a choice, in the order of most ground factors in reach first:
 *  - Offensive if it can pay (the payer keeps its plannedReserve for declarations of war) and at least OFFENSIVE_MIN_FACTORS of its ground factors stand within
 *    OPTION_REACH hexes of an enemy ground unit on that Front, and fewer than OFFENSIVE_MAX_FRONTS Offensive Options are paid for already;
 *  - else Attrition if any ground unit of its own stands within OPTION_REACH of one;
 *  - else Defensive.
 * Replacements are not counted (they do not take part in Attrition and attack only in a Counterattack, Ref 22.0, 12.1).
 * The Option is still not enforced by the combat rules (ticket 16-2), so for now the choice changes only what the Offensive Option costs.
 * TODO(verify) AER46: all three numbers are the computer's policy, not a rule.
 */
export const OPTION_REACH = 3;
export const OFFENSIVE_MIN_FACTORS = 6;
export const OFFENSIVE_MAX_FRONTS = 2;

type Select = Extract<Action, { type: "SELECT_FRONT_OPTION" }>;

/** Own ground factors within `reach` hexes of an enemy ground unit, per Front of that enemy unit's hex, and the count of own units that are. */
export function factorsInReach(ctx: GameContext, state: GameState, reach: number = OPTION_REACH): Record<Front, { factors: number; units: number }> {
  const out = Object.fromEntries(FRONTS.map((f) => [f, { factors: 0, units: 0 }])) as Record<Front, { factors: number; units: number }>;
  const ground = Object.values(state.units).filter((u) => isGroundCombatUnit(u) && u.type !== "replacement" && ctx.map.hexes[u.at] !== undefined);
  const mine = ground.filter((u) => sideOfOwner(u.owner) === state.activeSide);
  const theirs = ground.filter((u) => sideOfOwner(u.owner) !== state.activeSide);
  const coords = new Map<string, Hex | null>();
  const at = (u: Unit): Hex | null => {
    let h = coords.get(u.at);
    if (h === undefined) coords.set(u.at, (h = parseHexId(u.at)));
    return h;
  };
  for (const u of mine) {
    const a = at(u);
    if (!a) continue;
    const fronts = new Set<Front>();
    for (const e of theirs) {
      const b = at(e);
      const front = ctx.map.hexes[e.at]?.front;
      if (b && front && distance(a, b) <= reach && isEnemy(state, u.owner, e.owner)) fronts.add(front);
    }
    for (const f of fronts) {
      out[f].factors += u.strength;
      out[f].units += 1;
    }
  }
  return out;
}

/** The Option the policy wants on a Front, before the cap on Offensive Options and what can be paid. */
export function wantedOption(reach: { factors: number; units: number }): FrontOption {
  return reach.factors >= OFFENSIVE_MIN_FACTORS ? "offensive" : reach.units > 0 ? "attrition" : "defensive";
}

export function chooseOptions(ctx: GameContext, state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  const selects = legal.filter((a): a is Select => a.type === "SELECT_FRONT_OPTION");
  const reach = factorsInReach(ctx, state);
  const paid = Object.values(state.frontOptions).filter((c) => c?.option === "offensive" && c.paidBy !== undefined).length;
  const open = FRONTS.filter((f) => !state.frontOptions[f]);
  const order = [...open].sort((a, b) => reach[b].factors - reach[a].factors);
  for (const front of order) {
    const want = wantedOption(reach[front]);
    const offers = selects.filter((a) => a.front === front);
    if (want === "offensive") {
      const cost = optionCost(ctx, state, front, "offensive");
      const mayPay = cost === 0 || paid < OFFENSIVE_MAX_FRONTS;
      const pick = mayPay
        ? best(
            offers.filter((a) => a.option === "offensive" && (cost === 0 || (a.payer !== undefined && state.nations[a.payer].brpTotal - cost >= plannedReserve(state, a.payer)))),
            (a) => (a.payer ? state.nations[a.payer].brpTotal - plannedReserve(state, a.payer) : 0),
            cfg.seed,
            (a) => a.payer ?? "free",
          )
        : undefined;
      if (pick) return { action: pick, why: `Offensive Option on the ${front} Front: ${reach[front].factors} ground factors stand within ${OPTION_REACH} hexes of the enemy${pick.payer ? `, paid by ${pick.payer}` : " (free)"}.` };
    }
    const fallback: FrontOption = want === "defensive" ? "defensive" : "attrition";
    const pick = offers.find((a) => a.option === fallback);
    if (pick) return { action: pick, why: fallback === "attrition" ? `Attrition Option on the ${front} Front: ${reach[front].units} of its ground units stand within ${OPTION_REACH} hexes of the enemy.` : `Defensive Option on the ${front} Front: no ground unit of its own is within ${OPTION_REACH} hexes of the enemy.` };
  }
  return undefined;
}
