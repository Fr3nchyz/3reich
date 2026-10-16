import type { Action, ActionResult, GameEvent } from "./action-types";
import type { CombatOutcome } from "./combat";
import { combatOf, type CombatRecord, type PendingLosses } from "./combat-record";
import type { HexId } from "./hex";
import { ADVANCE_AFTER_COMBAT, lonersAt } from "./attack-rules";
import type { GameState, Side, Unit } from "./types";

/**
 * What an attack does to the units (Ref 12.1-12.2, spec 04): who is eliminated, the Exchange
 * allocation the owner chooses, and the advance that may follow.
 */

/**
 * Listing every way to remove enough factors stops at this many sets: `minimalSets` stops walking, and the sets it has are the
 * ones `legalActions` offers (ALLOCATE_LOSSES). A stack with many counters of similar strength can have more, so the sets past the
 * first 100 are never offered. The engine's applyAllocation still accepts any valid set, but the loss card (ui/lossOptions.ts) only
 * confirms listed sets: a player who picks an unlisted one is told it takes more than needed ("Take one off"), or that one unit must
 * come off, though that set is exactly enough. Not measured on real games yet. Behaviour is unchanged here; see the note in lossOptions.ts.
 */
const MAX_LISTED_SETS = 100;

/** The subsets of `ids` whose values reach `required` and in which no unit could be spared. */
export function minimalSets(ids: readonly string[], values: Readonly<Record<string, number>>, required: number): string[][] {
  const out: string[][] = [];
  const walk = (i: number, chosen: string[], sum: number) => {
    if (out.length >= MAX_LISTED_SETS) return;
    if (sum >= required) {
      if (chosen.every((id) => sum - values[id]! < required)) out.push(chosen);
      return;
    }
    for (let j = i; j < ids.length; j++) walk(j + 1, [...chosen, ids[j]!], sum + values[ids[j]!]!);
  };
  walk(0, [], 0);
  return out;
}

/** Removes the units from the game, one UNIT_ELIMINATED event each. */
function eliminate(state: GameState, ids: readonly string[]): { state: GameState; events: GameEvent[] } {
  const units = { ...state.units };
  const events: GameEvent[] = [];
  for (const id of ids) {
    const u = units[id];
    if (!u) continue;
    delete units[id];
    events.push({ type: "UNIT_ELIMINATED", unitId: id, owner: u.owner, at: u.at });
  }
  return { state: { ...state, units }, events };
}

const withRecord = (state: GameState, patch: Partial<CombatRecord>): GameState => ({ ...state, combat: { ...combatOf(state), ...patch } });

/**
 * The battle is over: air units and the like left alone in the hex are destroyed (ALONE_NONGROUND_DESTROYED), and the survivors of the
 * attack may advance if the defenders' hex is empty (TODO(verify), attack-rules.ts). `by` are the attackers as they stood before the battle.
 */
function finishBattle(state: GameState, attackers: readonly string[], target: HexId, by: readonly Unit[]): { state: GameState; events: GameEvent[] } {
  const loners = lonersAt(state, by, target);
  const swept = eliminate(state, loners.map((u) => u.id));
  const done = finishWithRecord(swept.state, attackers, target);
  const note: GameEvent[] = loners.length > 0 ? [{ type: "UNITS_SWEPT", hex: target, units: loners.map((u) => ({ id: u.id, owner: u.owner, type: u.type, strength: u.strength })) }] : [];
  return { state: done, events: [...note, ...swept.events] };
}

/** An attack on a hex that holds only counters that cannot defend on the ground: they are destroyed, and the attackers may advance. */
export const applySweep = (state: GameState, attackers: readonly Unit[], target: HexId): { state: GameState; events: GameEvent[] } =>
  finishBattle(state, attackers.map((u) => u.id), target, attackers);

function finishWithRecord(state: GameState, attackers: readonly string[], target: HexId): GameState {
  const survivors = attackers.filter((id) => state.units[id] !== undefined);
  const empty = !Object.values(state.units).some((u) => u.at === target);
  const rec = combatOf(state);
  const advances = ADVANCE_AFTER_COMBAT && empty && survivors.length > 0 ? [...rec.advances, { to: target, units: survivors }] : rec.advances;
  return withRecord(state, { pending: null, advances });
}

/** What an Exchange costs each side (Ref 12.2). */
export interface ExchangeCost {
  /** The attackers' factors, and the defenders' at the multiple given. */
  attackTotal: number;
  defenseTotal: number;
  /** The side with fewer factors loses every unit it has in the battle; with equal totals both do. */
  attackersLoseAll: boolean;
  defendersLoseAll: boolean;
  /** The larger side picks which of its units go; null when both lose everything (equal totals), so nobody picks. */
  chooser: "attackers" | "defenders" | null;
  /** The factors the chooser must remove at least (the smaller side's total); 0 when nobody picks. */
  required: number;
  /** What each of the chooser's units counts for: its strength, times the multiple for defenders; empty when nobody picks. */
  values: Record<string, number>;
}

/**
 * The arithmetic of an Exchange, apart from the dice: the side with fewer factors is eliminated, the larger removes at least that many
 * (Ref 12.2). `multiple` is the factor the defenders count at: their terrain multiple in the original attack, 1 in a counterattack.
 * TODO(verify): the defenders' multiplied value is also what they remove when they are the larger side.
 */
export function exchangeCost(attackers: readonly Unit[], defenders: readonly Unit[], multiple: number): ExchangeCost {
  const attackTotal = attackers.reduce((n, u) => n + u.strength, 0);
  const defenseTotal = defenders.reduce((n, u) => n + u.strength * multiple, 0);
  const attackersLoseAll = attackTotal <= defenseTotal;
  const defendersLoseAll = defenseTotal <= attackTotal;
  if (attackersLoseAll && defendersLoseAll) return { attackTotal, defenseTotal, attackersLoseAll, defendersLoseAll, chooser: null, required: 0, values: {} };
  const choosing = attackersLoseAll ? defenders : attackers;
  const values = Object.fromEntries(choosing.map((u) => [u.id, attackersLoseAll ? u.strength * multiple : u.strength]));
  return { attackTotal, defenseTotal, attackersLoseAll, defendersLoseAll, chooser: attackersLoseAll ? "defenders" : "attackers", required: attackersLoseAll ? attackTotal : defenseTotal, values };
}

export interface Battle {
  outcome: CombatOutcome;
  side: Side;
  target: HexId;
  attackers: Unit[];
  defenders: Unit[];
  multiplier: number;
}

/**
 * Applies the result of a battle. An attacker or defender elimination removes that side's units. An
 * Exchange (Ref 12.2): the side with fewer factors loses everything; the other removes at least as
 * many, chosen by its owner (ALLOCATE_LOSSES) unless only one choice exists. On the original attack the
 * defenders count at their terrain multiple; on a counterattack both sides count basic factors.
 * TODO(verify): the defenders' multiplied value is also what they remove when they are the larger side.
 */
export function applyOutcome(state: GameState, b: Battle): { state: GameState; events: GameEvent[] } {
  const ids = (us: readonly Unit[]) => us.map((u) => u.id);
  const attackerIds = ids(b.attackers);
  if (b.outcome.kind === "attacker-eliminated") {
    const gone = eliminate(state, attackerIds);
    const done = finishBattle(gone.state, attackerIds, b.target, b.attackers);
    return { state: done.state, events: [...gone.events, ...done.events] };
  }
  if (b.outcome.kind === "defender-eliminated") {
    const gone = eliminate(state, ids(b.defenders));
    const done = finishBattle(gone.state, attackerIds, b.target, b.attackers);
    return { state: done.state, events: [...gone.events, ...done.events] };
  }
  const cost = exchangeCost(b.attackers, b.defenders, b.outcome.multipliedDefense ? b.multiplier : 1);
  const wholly = eliminate(state, [...(cost.attackersLoseAll ? attackerIds : []), ...(cost.defendersLoseAll ? ids(b.defenders) : [])]);
  // The larger side (both, if equal) removes at least as many factors as the smaller side has; with equal totals that is everything.
  if (cost.chooser === null) {
    const done = finishBattle(wholly.state, attackerIds, b.target, b.attackers);
    return { state: done.state, events: [...wholly.events, ...done.events] };
  }
  const { required, values } = cost;
  const choosing = cost.chooser === "defenders" ? b.defenders : b.attackers;
  const candidates = ids(choosing);
  const sets = minimalSets(candidates, values, required);
  if (sets.length === 1) {
    const rest = eliminate(wholly.state, sets[0]!);
    const done = finishBattle(rest.state, attackerIds, b.target, b.attackers);
    return { state: done.state, events: [...wholly.events, ...rest.events, ...done.events] };
  }
  const pending: PendingLosses = { chooser: cost.chooser === "defenders" ? (b.side === "axis" ? "allies" : "axis") : b.side, target: b.target, candidates, values, required, attackers: attackerIds };
  return { state: withRecord(wholly.state, { pending }), events: wholly.events };
}

/** The losses the chooser may pick now: every set of units that is just enough. */
export function legalAllocations(state: GameState): Action[] {
  const p = combatOf(state).pending;
  return p ? minimalSets(p.candidates, p.values, p.required).map((units): Action => ({ type: "ALLOCATE_LOSSES", side: p.chooser, units })) : [];
}

export function applyAllocation(state: GameState, action: Extract<Action, { type: "ALLOCATE_LOSSES" }>): ActionResult {
  const p = combatOf(state).pending;
  if (!p) return { ok: false, error: "No Exchange is waiting for losses to be chosen." };
  if (action.side !== p.chooser) return { ok: false, error: `The ${p.chooser} player chooses these losses, not ${action.side}.` };
  const units = action.units;
  if (!Array.isArray(units) || new Set(units).size !== units.length || units.some((id) => !p.candidates.includes(id))) {
    return { ok: false, error: `Losses must be distinct units from the stack that loses: ${p.candidates.join(", ")}.` };
  }
  const sum = units.reduce((n, id) => n + p.values[id]!, 0);
  if (sum < p.required) return { ok: false, error: `The Exchange takes at least ${p.required} factors; ${units.join(", ") || "no units"} count for ${sum}.` };
  if (units.some((id) => sum - p.values[id]! >= p.required)) return { ok: false, error: `Those losses are more than the Exchange takes: a unit could be spared.` };
  const gone = eliminate(state, units);
  const done = finishBattle(gone.state, p.attackers, p.target, p.attackers.flatMap((id) => (state.units[id] ? [state.units[id]] : [])));
  return { ok: true, state: done.state, events: [{ type: "LOSSES_CHOSEN", side: action.side, units: [...units] }, ...gone.events, ...done.events] };
}
