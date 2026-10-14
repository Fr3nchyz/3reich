import type { Action, ActionResult, GameEvent } from "./action-types";
import { applyOutcome, legalAllocations } from "./attack-losses";
import { ONE_ATTACK_PER_HEX, attackNumbers, attackerPool, crossable, defendersAt, frontAllowsAttack, neighborIds } from "./attack-rules";
import { resolveOffensiveCombat } from "./combat";
import { combatOf } from "./combat-record";
import { enterHexes } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { stackingProblem } from "./placement";
import type { GameState, Unit } from "./types";

/**
 * Ground combat at step 7h (Ref 12.1-12.2, spec 04). `ATTACK` names the attacking units (each
 * attacks one hex, PC README 14.23) and the adjacent enemy hex; the odds come from the units'
 * factors and the defender's terrain, the die from the game's seeded generator, and the result is
 * applied at once. An Exchange the owner must allocate waits for ALLOCATE_LOSSES. Survivors may
 * then ADVANCE into a hex the defenders left empty (TODO(verify), attack-rules.ts).
 *
 * Not built yet (TODO(verify)): air and naval support, seaborne invasions, exploitation (7j-7o),
 * Zones of Control, supply (hooks in attack-rules.ts), control of hexes taken, the loss of
 * fortress status on occupation, and rebuilding eliminated units.
 */

type AttackAction = Extract<Action, { type: "ATTACK" }>;
type AdvanceAction = Extract<Action, { type: "ADVANCE" }>;

/** Attackers grouped by the enemy hex they could attack, for every hex that can be attacked now. */
function attackables(ctx: GameContext, state: GameState): Map<HexId, Unit[]> {
  const rec = combatOf(state);
  const out = new Map<HexId, Unit[]>();
  const pool = attackerPool(ctx, state, state.activeSide, rec.attacked);
  const targets = new Set(pool.flatMap((u) => neighborIds(ctx, u.at)));
  for (const t of [...targets].sort()) {
    if (ONE_ATTACK_PER_HEX && rec.targets.includes(t)) continue;
    const front = ctx.map.hexes[t]!.front;
    if (!frontAllowsAttack(ctx, state, state.activeSide, front)) continue;
    const from = pool.filter((u) => crossable(ctx, u.at, t));
    if (from.length > 0 && defendersAt(state, from, t).length > 0) out.set(t, from);
  }
  return out;
}

/** Whether the step has anything to wait for: an attack could be made. */
export const hasCombatWork = (ctx: GameContext, state: GameState): boolean => attackables(ctx, state).size > 0;

/** The attacks listed for each target: everyone who can reach it, and each source hex alone when there are several. */
function legalAttacks(ctx: GameContext, state: GameState): Action[] {
  const out: Action[] = [];
  for (const [target, from] of attackables(ctx, state)) {
    const all = from.filter((u) => defendersAt(state, [u], target).length > 0);
    out.push({ type: "ATTACK", side: state.activeSide, units: all.map((u) => u.id), target });
    const hexes = [...new Set(all.map((u) => u.at))];
    if (hexes.length > 1) for (const h of hexes) out.push({ type: "ATTACK", side: state.activeSide, units: all.filter((u) => u.at === h).map((u) => u.id), target });
  }
  return out;
}

/**
 * Why these units may not all end in `to` (stacking and the Anglo-French rule of Ref 5.0, 26.0, as in setup),
 * or null. Units are added one at a time so each sees the ones before it.
 */
function advanceProblem(ctx: GameContext, state: GameState, ids: readonly string[], to: HexId): string | null {
  let s = state;
  for (const id of ids) {
    const u = s.units[id]!;
    const problem = stackingProblem(ctx, s, u.owner, { type: u.type, strength: u.strength, ...(u.nationality ? { nationality: u.nationality } : {}) }, to);
    if (problem) return problem;
    s = { ...s, units: { ...s.units, [id]: { ...u, at: to } } };
  }
  return null;
}

/**
 * Each way the survivors may advance: any set that fits the hex. Only the first 12 survivors are
 * considered (at most six hexes of two units can attack one hex), which bounds the subsets listed.
 */
function legalAdvances(ctx: GameContext, state: GameState): Action[] {
  const out: Action[] = [];
  for (const chance of combatOf(state).advances) {
    const ids = chance.units.filter((id) => state.units[id]).slice(0, 12);
    for (let mask = 1; mask < 1 << ids.length; mask++) {
      const pick = ids.filter((_, i) => mask & (1 << i));
      if (!advanceProblem(ctx, state, pick, chance.to)) out.push({ type: "ADVANCE", side: state.activeSide, units: pick, to: chance.to });
    }
  }
  return out;
}

/** The step's actions: the losses to choose while an Exchange waits, otherwise attacks and advances. */
export function legalCombatActions(ctx: GameContext, state: GameState): Action[] {
  return combatOf(state).pending ? legalAllocations(state) : [...legalAttacks(ctx, state), ...legalAdvances(ctx, state)];
}

export function applyAttack(ctx: GameContext, state: GameState, action: AttackAction): ActionResult {
  const rec = combatOf(state);
  if (rec.pending) return { ok: false, error: "An Exchange is waiting for its losses to be chosen first." };
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  const ids = action.units;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) return { ok: false, error: "An attack names one or more distinct units." };
  if (ids.some((id) => !Object.hasOwn(state.units, id))) return { ok: false, error: "An attacking unit is not on the map." };
  const units = ids.map((id) => state.units[id]!);
  const target = typeof action.target === "string" && Object.hasOwn(ctx.map.hexes, action.target) ? ctx.map.hexes[action.target] : undefined;
  if (!target) return { ok: false, error: `${action.target} is not a hex on the map.` };
  const pool = attackerPool(ctx, state, state.activeSide, rec.attacked);
  const bad = units.find((u) => !pool.includes(u));
  if (bad) return { ok: false, error: `${bad.id} cannot attack: it must be a ground unit of the ${state.activeSide} side in play that has not attacked this turn.` };
  const far = units.find((u) => !crossable(ctx, u.at, action.target));
  if (far) return { ok: false, error: `${far.id} at ${far.at} is not next to ${action.target} across a hexside ground units may attack over.` };
  if (ONE_ATTACK_PER_HEX && rec.targets.includes(action.target)) return { ok: false, error: `${action.target} has already been attacked this turn.` };
  if (!frontAllowsAttack(ctx, state, state.activeSide, target.front)) return { ok: false, error: `The ${state.activeSide} side may not attack on the ${target.front} front now.` };
  const defenders = defendersAt(state, units, action.target);
  if (defenders.length === 0) return { ok: false, error: `${action.target} holds no enemy ground unit to attack.` };

  const numbers = attackNumbers(ctx, state, units, defenders, action.target);
  const res = resolveOffensiveCombat({ attackFactors: numbers.attackFactors, defenseBasicFactors: numbers.defenseFactors, defenseMultiplier: numbers.multiplier }, state.rngState);
  const marked: GameState = { ...state, rngState: res.rngState, combat: { ...rec, attacked: [...rec.attacked, ...ids], targets: [...rec.targets, action.target] } };
  const applied = applyOutcome(marked, { outcome: res.outcome, side: state.activeSide, target: action.target, attackers: units, defenders, multiplier: numbers.multiplier });
  const event = { type: "COMBAT_RESOLVED" as const, side: state.activeSide, target: action.target, attackers: [...ids], attackFactors: numbers.attackFactors, defenseFactors: numbers.defenseFactors, multiplier: numbers.multiplier, rounds: res.rounds, outcome: res.outcome.kind };
  return { ok: true, state: applied.state, events: [event, ...applied.events] };
}

export function applyAdvance(ctx: GameContext, state: GameState, action: AdvanceAction): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  const rec = combatOf(state);
  const chance = rec.advances.find((a) => a.to === action.to);
  if (!chance) return { ok: false, error: `No unit may advance into ${action.to}: it was not left empty by a battle this turn, or the advance was made.` };
  const ids = action.units;
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !chance.units.includes(id) || !Object.hasOwn(state.units, id))) {
    return { ok: false, error: `Only surviving units that attacked ${action.to} may advance into it.` };
  }
  const problem = advanceProblem(ctx, state, ids, action.to);
  if (problem) return { ok: false, error: problem };
  const from = [...new Set(ids.map((id) => state.units[id]!.at))];
  const units = { ...state.units };
  for (const id of ids) units[id] = { ...units[id]!, at: action.to };
  const advances = rec.advances.filter((a) => a !== chance);
  // Entering the hex can change its control (Ref 7.0; control.ts). TODO(verify): the rules text on whether an
  // advance after combat takes control the way movement does is not in the repo; this applies the same rule.
  let next: GameState = { ...state, units, combat: { ...rec, advances } };
  const events: GameEvent[] = [{ type: "UNITS_ADVANCED", units: [...ids], from, to: action.to }];
  for (const id of ids) {
    const entered = enterHexes(ctx, next, next.units[id]!, [action.to]);
    next = entered.state;
    events.push(...entered.events);
  }
  return { ok: true, state: next, events };
}
