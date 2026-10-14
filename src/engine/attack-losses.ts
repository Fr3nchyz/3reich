import type { Action, ActionResult, GameEvent } from "./action-types";
import type { CombatOutcome } from "./combat";
import { combatOf, type CombatRecord, type PendingLosses } from "./combat-record";
import type { HexId } from "./hex";
import { ADVANCE_AFTER_COMBAT } from "./attack-rules";
import type { GameState, Side, Unit } from "./types";

/**
 * What an attack does to the units (Ref 12.1-12.2, spec 04): who is eliminated, the Exchange
 * allocation the owner chooses, and the advance that may follow.
 */

/** Listing every way to remove enough factors stops here; a stack has few counters, so it is not reached. */
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

/** The battle is over: the survivors of the attack may advance if the defenders' hex is empty (TODO(verify), attack-rules.ts). */
function finishBattle(state: GameState, attackers: readonly string[], target: HexId): GameState {
  const survivors = attackers.filter((id) => state.units[id] !== undefined);
  const empty = !Object.values(state.units).some((u) => u.at === target);
  const rec = combatOf(state);
  const advances = ADVANCE_AFTER_COMBAT && empty && survivors.length > 0 ? [...rec.advances, { to: target, units: survivors }] : rec.advances;
  return withRecord(state, { pending: null, advances });
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
    return { state: finishBattle(gone.state, attackerIds, b.target), events: gone.events };
  }
  if (b.outcome.kind === "defender-eliminated") {
    const gone = eliminate(state, ids(b.defenders));
    return { state: finishBattle(gone.state, attackerIds, b.target), events: gone.events };
  }
  const m = b.outcome.multipliedDefense ? b.multiplier : 1;
  const attackTotal = b.attackers.reduce((n, u) => n + u.strength, 0);
  const defenseTotal = b.defenders.reduce((n, u) => n + u.strength * m, 0);
  const attackersLose = attackTotal <= defenseTotal;
  const defendersLose = defenseTotal <= attackTotal;
  const wholly = eliminate(state, [...(attackersLose ? attackerIds : []), ...(defendersLose ? ids(b.defenders) : [])]);
  // The larger side (both, if equal) removes at least as many factors as the smaller side has; with equal totals that is everything.
  if (attackersLose && defendersLose) return { state: finishBattle(wholly.state, attackerIds, b.target), events: wholly.events };
  const choosing = attackersLose ? b.defenders : b.attackers;
  const required = attackersLose ? attackTotal : defenseTotal;
  const values = Object.fromEntries(choosing.map((u) => [u.id, attackersLose ? u.strength * m : u.strength]));
  const candidates = ids(choosing);
  const sets = minimalSets(candidates, values, required);
  if (sets.length === 1) {
    const rest = eliminate(wholly.state, sets[0]!);
    return { state: finishBattle(rest.state, attackerIds, b.target), events: [...wholly.events, ...rest.events] };
  }
  const pending: PendingLosses = { chooser: attackersLose ? (b.side === "axis" ? "allies" : "axis") : b.side, target: b.target, candidates, values, required, attackers: attackerIds };
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
  if (new Set(units).size !== units.length || units.some((id) => !p.candidates.includes(id))) {
    return { ok: false, error: `Losses must be distinct units from the stack that loses: ${p.candidates.join(", ")}.` };
  }
  const sum = units.reduce((n, id) => n + p.values[id]!, 0);
  if (sum < p.required) return { ok: false, error: `The Exchange takes at least ${p.required} factors; ${units.join(", ") || "no units"} count for ${sum}.` };
  if (units.some((id) => sum - p.values[id]! >= p.required)) return { ok: false, error: `Those losses are more than the Exchange takes: a unit could be spared.` };
  const gone = eliminate(state, units);
  return { ok: true, state: finishBattle(gone.state, p.attackers, p.target), events: [{ type: "LOSSES_CHOSEN", side: action.side, units: [...units] }, ...gone.events] };
}
