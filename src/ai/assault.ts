import type { Action } from "../engine/actions";
import { attackNumbers, defendersAt } from "../engine/attack-rules";
import { combatOf } from "../engine/combat-record";
import { ODDS_COLUMNS, type OddsColumn } from "../engine/combat";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { isObjective } from "./geo";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * Step 7h, ground attacks. COMPUTER POLICY, not rules (spec 05; every number is TODO(verify), to be tuned by play-testing).
 * Of the ATTACK actions the engine lists it makes the best one whose odds (the column the engine's own `attackNumbers`
 * gives, terrain included) are at least ATTACK_MIN_COLUMN (ATTACK_MIN_COLUMN_SUPERIOR where the attackers hold ATTACK_SUPERIORITY
 * times the defenders' printed factors over the whole hex) and whose Exchange is acceptable: an Exchange costs the attackers
 * at least the defender's multiplied factors (Ref 12.2), and that may be at most ATTACK_MAX_EXCHANGE_FACTORS, or
 * ATTACK_MAX_EXCHANGE_FACTORS_STRONG at odds of ATTACK_STRONG_COLUMN or better (so a large stack may assault a strongly held hex that a
 * small one may not; with the cap alone, big armies stood idle beside a fortified hex they could take at 2-1). Better odds first, then an attack on a capital or objective, then the bigger force. After a battle that left a
 * hex empty it advances with as many survivors as the hex takes. When nothing qualifies it ends the step.
 */
export const ATTACK_MIN_COLUMN: OddsColumn = "2-1";
/** Where the attackers hold at least ATTACK_SUPERIORITY times the defenders' printed factors (before terrain), the least column falls to this. */
export const ATTACK_SUPERIORITY = 3;
export const ATTACK_MIN_COLUMN_SUPERIOR: OddsColumn = "1-1";
export const ATTACK_MAX_EXCHANGE_FACTORS = 8;
export const ATTACK_MAX_EXCHANGE_FACTORS_STRONG = 16;
export const ATTACK_STRONG_COLUMN: OddsColumn = "2-1";
export const ATTACK_MAX_PER_TURN = 40;
/** Base score of a sweep of a hex with only air units or the like: below any real attack, so the units are first offered to real attacks. */
export const SWEEP_SCORE = -1000;

type Attack = Extract<Action, { type: "ATTACK" }>;
type Advance = Extract<Action, { type: "ADVANCE" }>;

export function chooseAttack(ctx: GameContext, state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  if (combatOf(state).targets.length >= ATTACK_MAX_PER_TURN) return undefined;
  const floor = ODDS_COLUMNS.indexOf(ATTACK_MIN_COLUMN);
  const floorSuperior = ODDS_COLUMNS.indexOf(ATTACK_MIN_COLUMN_SUPERIOR);
  const strong = ODDS_COLUMNS.indexOf(ATTACK_STRONG_COLUMN);
  const scored = new Map<Attack, number>();
  for (const a of legal) {
    if (a.type !== "ATTACK") continue;
    const units = a.units.map((id) => state.units[id]!);
    const defenders = defendersAt(state, units, a.target);
    // Only air units or the like in the hex (rules: ALONE_NONGROUND_DESTROYED): no roll and no risk, but it must not take units a real
    // attack could use, so it scores below every real attack (which scores 0 or more).
    if (defenders.length === 0) {
      // The fewest factors, so one weak unit, and infantry before anything else.
      scored.set(a, SWEEP_SCORE + (units.every((u) => u.type === "infantry") ? 10 : 0) - units.reduce((n, u) => n + u.strength, 0) + (isObjective(ctx, a.target) ? 5 : 0));
      continue;
    }
    const n = attackNumbers(ctx, state, units, defenders, a.target);
    const column = n.column === null ? -1 : ODDS_COLUMNS.indexOf(n.column);
    const exchangeCap = column >= strong ? ATTACK_MAX_EXCHANGE_FACTORS_STRONG : ATTACK_MAX_EXCHANGE_FACTORS;
    if (column < (n.attackFactors >= ATTACK_SUPERIORITY * n.defenseFactors ? Math.min(floor, floorSuperior) : floor) || n.defenseFactors * n.multiplier > exchangeCap) continue;
    scored.set(a, column * 1000 + (isObjective(ctx, a.target) ? 500 : 0) + Math.min(n.attackFactors, 99));
  }
  const pick = best([...scored.keys()], (a) => scored.get(a)!, cfg.seed, (a) => `${a.target}:${a.units.join(",")}`);
  if (!pick) return undefined;
  const units = pick.units.map((id) => state.units[id]!);
  const defenders = defendersAt(state, units, pick.target);
  if (defenders.length === 0) return { action: pick, why: `Attacks ${pick.target}, where only air units or the like stand: they are destroyed without a roll.` };
  const n = attackNumbers(ctx, state, units, defenders, pick.target);
  return { action: pick, why: `Attacks ${pick.target} with ${n.attackFactors} factors against ${n.defenseFactors}${n.multiplier > 1 ? ` (x${n.multiplier})` : ""}, odds ${n.column}.` };
}

/** After a won battle: the largest advance the engine lists, as it takes the hex and nothing in the rules asks for more. */
export function chooseAdvance(legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  const advances = legal.filter((a): a is Advance => a.type === "ADVANCE");
  const pick = best(advances, (a) => a.units.length, cfg.seed, (a) => `${a.to}:${a.units.join(",")}`);
  return pick ? { action: pick, why: `Advances ${pick.units.length} unit${pick.units.length === 1 ? "" : "s"} into ${pick.to}, which the defenders left.` } : undefined;
}
