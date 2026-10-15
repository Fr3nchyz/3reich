import type { GameEvent } from "../engine/action-types";
import type { CombatRound } from "../engine/combat";
import { turnKey } from "../engine/combat-record";
import { sideOfOwner } from "../engine/setup";
import type { GameState, Side, Unit } from "../engine/types";

/**
 * What the last battle of the player's own attack did, built from the events the session already logs (COMBAT_RESOLVED, UNIT_ELIMINATED,
 * UNITS_SWEPT): the data of the result card (spec 07, State 3). Pure: events and the position before them in, plain data out. Counters are
 * kept as the units they were, so the card can name them after they are gone.
 */

export interface BattleResult {
  /** The Player Turn it happened in; the card goes with it. */
  turn: string;
  side: Side;
  target: string;
  attackFactors: number;
  defenseFactors: number;
  multiplier: number;
  rounds: CombatRound[];
  outcome: "attacker-eliminated" | "defender-eliminated" | "exchange";
  sweep: boolean;
  /** Eliminated units of the attacking side, and of the defending side (without the swept ones). */
  lostAttackers: Unit[];
  lostDefenders: Unit[];
  /** Air units, fleets and the like destroyed alone in the hex after the battle. */
  swept: Unit[];
  /** Just made: the card's heading takes the keyboard focus on the next draw, once. */
  fresh: boolean;
}

/**
 * The battle after an action: a new one when the action resolved an attack by `mySide` (null for any other side's, which also drops an old
 * card), and the old one with the units this action eliminated when it is a later step of the same battle (the losses of an Exchange).
 * `before` is the position the action was made in, where the eliminated units are still found.
 */
export function trackBattle(prev: BattleResult | null, events: readonly GameEvent[], before: GameState, mySide: Side | null): BattleResult | null {
  const started = events.find((e): e is Extract<GameEvent, { type: "COMBAT_RESOLVED" }> => e.type === "COMBAT_RESOLVED");
  let battle: BattleResult | null = prev;
  if (started) {
    battle = started.side === mySide
      ? { turn: turnKey(before), side: started.side, target: started.target, attackFactors: started.attackFactors, defenseFactors: started.defenseFactors, multiplier: started.multiplier, rounds: started.rounds, outcome: started.outcome, sweep: started.sweep === true, lostAttackers: [], lostDefenders: [], swept: [], fresh: true }
      : null;
  }
  if (!battle) return null;
  const sweptIds = new Set(events.flatMap((e) => (e.type === "UNITS_SWEPT" ? e.units.map((u) => u.id) : [])));
  const gone = events.flatMap((e) => (e.type === "UNIT_ELIMINATED" && before.units[e.unitId] ? [before.units[e.unitId]!] : []));
  if (gone.length === 0) return battle;
  return {
    ...battle,
    fresh: started ? battle.fresh : false,
    lostAttackers: [...battle.lostAttackers, ...gone.filter((u) => !sweptIds.has(u.id) && sideOfOwner(u.owner) === battle.side)],
    lostDefenders: [...battle.lostDefenders, ...gone.filter((u) => !sweptIds.has(u.id) && sideOfOwner(u.owner) !== battle.side)],
    swept: [...battle.swept, ...gone.filter((u) => sweptIds.has(u.id))],
  };
}
