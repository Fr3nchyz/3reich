import type { Action, ActionResult, GameEvent } from "./action-types";
import { angloFrenchStopProblem } from "./anglo-french";
import { applyOutcome, applySweep, legalAllocations } from "./attack-losses";
import { attackHexAllowed, attackNumbers, attackerPool, crossable, defendersAt, frontAllowsAttack, lonersAt, neighborIds } from "./attack-rules";
import { resolveOffensiveCombat } from "./combat";
import { breakthroughAfter, legalPlacements, openBreakthrough } from "./breakthrough";
import { movesOf } from "./move-record";
import { combatOf } from "./combat-record";
import { exploitOf, exploiterIds } from "./exploit-record";
import { exploitAdvanceProblem, markExploitAttackers } from "./exploit-action";
import { enterHexes } from "./control";
import { noteMinorEntry } from "./minors-duty";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { stackingProblem } from "./placement";
import { UNSUPPLIED_CANNOT_ADVANCE, wasCutOff } from "./supply-effects";
import type { GameState, Unit } from "./types";

/**
 * Ground combat at step 7h (Ref 12.1-12.2, spec 04). `ATTACK` names the attacking units (each
 * attacks one hex, PC README 14.23) and the adjacent enemy hex; the odds come from the units'
 * factors and the defender's terrain, the die from the game's seeded generator, and the result is
 * applied at once. An Exchange the owner must allocate waits for ALLOCATE_LOSSES. Survivors may
 * then ADVANCE into a hex the defenders left empty (TODO(verify), attack-rules.ts).
 *
 * A won attack with armor in it, advanced into, makes a Breakthrough hex (breakthrough.ts, spec 16 R10, R11).
 *
 * Not built yet (TODO(verify)): air and naval support, seaborne invasions, exploitation movement and combat (7j-7o),
 * Zones of Control, supply (hooks in attack-rules.ts), control of hexes taken, the loss of
 * fortress status on occupation, and rebuilding eliminated units.
 */

type AttackAction = Extract<Action, { type: "ATTACK" }>;
type AdvanceAction = Extract<Action, { type: "ADVANCE" }>;

/** Whether the game waits at step 7o, where only exploiting armor attacks and advances (spec 16 R13). */
const atExploitCombat = (state: GameState): boolean => state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step === "7o";

/** At 7o only a chance made by exploiters is theirs to advance into (a left-over ordinary chance of step 7h is not). */
const exploitChance = (state: GameState, units: readonly string[]): boolean => units.every((id) => exploiterIds(state).includes(id));

/** Attackers grouped by the enemy hex they could attack, for every hex that can be attacked now. */
export function attackables(ctx: GameContext, state: GameState): Map<HexId, Unit[]> {
  const rec = combatOf(state);
  const out = new Map<HexId, Unit[]>();
  const pool = attackerPool(ctx, state, state.activeSide, [...rec.attacked, ...exploiterIds(state)]); // exploiting armor takes no part in ordinary combat (spec 16 AER13)
  const targets = new Set(pool.flatMap((u) => neighborIds(ctx, u.at)));
  for (const t of [...targets].sort()) {
    if (!attackHexAllowed(rec.targets, t)) continue;
    const front = ctx.map.hexes[t]!.front;
    if (!frontAllowsAttack(ctx, state, state.activeSide, front)) continue;
    const from = pool.filter((u) => crossable(ctx, u.at, t));
    if (from.length > 0 && (defendersAt(state, from, t).length > 0 || lonersAt(state, from, t).length > 0)) out.set(t, from);
  }
  return out;
}

/** Whether the step has anything to wait for: an attack could be made. */
export const hasCombatWork = (ctx: GameContext, state: GameState): boolean => attackables(ctx, state).size > 0;

/** The attacks listed for each target: everyone who can reach it, and each source hex alone when there are several. */
function legalAttacks(ctx: GameContext, state: GameState): Action[] {
  const out: Action[] = [];
  for (const [target, from] of attackables(ctx, state)) {
    const all = from.filter((u) => defendersAt(state, [u], target).length > 0 || lonersAt(state, [u], target).length > 0);
    out.push({ type: "ATTACK", side: state.activeSide, units: all.map((u) => u.id), target });
    const hexes = [...new Set(all.map((u) => u.at))];
    if (hexes.length > 1) for (const h of hexes) out.push({ type: "ATTACK", side: state.activeSide, units: all.filter((u) => u.at === h).map((u) => u.id), target });
    // A sweep of a hex with only air units or the like needs one ground unit, so each may go alone (the computer sends the least it can).
    if (defendersAt(state, all, target).length === 0) {
      const have = (ids: string[]) => out.some((a) => a.type === "ATTACK" && a.target === target && a.units.join() === ids.join());
      for (const u of all) if (!have([u.id])) out.push({ type: "ATTACK", side: state.activeSide, units: [u.id], target });
    }
  }
  return out;
}

/**
 * Why these units may not all end in `to` (stacking and the Anglo-French rule of Ref 5.0, 26.0, as in setup),
 * or null. Units are added one at a time so each sees the ones before it.
 */
function advanceProblem(ctx: GameContext, state: GameState, ids: readonly string[], to: HexId): string | null {
  const cut = ids.find((id) => UNSUPPLIED_CANNOT_ADVANCE && wasCutOff(state, id));
  if (cut) return `${cut} was out of supply when the turn began and cannot advance (Ref 12.21).`;
  let s = state;
  for (const id of ids) {
    const u = s.units[id]!;
    const problem = angloFrenchStopProblem(ctx, state, u.owner, to) ?? stackingProblem(ctx, s, u.owner, { type: u.type, strength: u.strength, ...(u.nationality ? { nationality: u.nationality } : {}) }, to);
    if (problem) return problem;
    s = { ...s, units: { ...s.units, [id]: { ...u, at: to } } };
  }
  return null;
}

/**
 * Each way the survivors may advance: any set that fits the hex. Only the first 12 survivors are
 * considered (at most six hexes of two units can attack one hex), which bounds the subsets listed.
 */
export function legalAdvances(ctx: GameContext, state: GameState): Action[] {
  const found: { mask: number; action: Action }[] = [];
  const exploiting = atExploitCombat(state);
  const record = exploitOf(state);
  for (const chance of combatOf(state).advances) {
    if (exploiting && !exploitChance(state, chance.units)) continue;
    const ids = chance.units.filter((id) => state.units[id] && !(UNSUPPLIED_CANNOT_ADVANCE && wasCutOff(state, id))).slice(0, 12); // Ref 12.21: units cut off at the start of the turn cannot advance
    // A set is listed when advanceProblem finds nothing, and that adds its units one at a time in this order, so a set
    // fits only if the same set without its last unit fits and that unit then fits on top. Walking the sets that way
    // checks each fitting set once (and never looks at a set whose start fails) instead of re-checking every subset
    // from its first unit; the sets are then listed by their bit mask as before.
    const walk = (s: GameState, from: number, mask: number): void => {
      for (let i = from; i < ids.length; i++) {
        const id = ids[i]!;
        const u = s.units[id]!;
        if ((exploiting && exploitAdvanceProblem(ctx, s, record, id, chance.to)) || (angloFrenchStopProblem(ctx, state, u.owner, chance.to) ?? stackingProblem(ctx, s, u.owner, { type: u.type, strength: u.strength, ...(u.nationality ? { nationality: u.nationality } : {}) }, chance.to))) continue;
        const next = mask | (1 << i);
        found.push({ mask: next, action: { type: "ADVANCE", side: state.activeSide, units: ids.filter((_, k) => next & (1 << k)), to: chance.to } });
        walk({ ...s, units: { ...s.units, [id]: { ...u, at: chance.to } } }, i + 1, next);
      }
    };
    const start = found.length;
    walk(state, 0, 0);
    found.splice(start, found.length - start, ...found.slice(start).sort((a, b) => a.mask - b.mask));
  }
  return found.map((f) => f.action);
}

/** The step's actions: the losses to choose while an Exchange waits, otherwise attacks and advances. */
export function legalCombatActions(ctx: GameContext, state: GameState): Action[] {
  return combatOf(state).pending ? legalAllocations(state) : [...legalAttacks(ctx, state), ...legalAdvances(ctx, state), ...legalPlacements(ctx, state)];
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
  const exploiting = units.find((u) => exploiterIds(state).includes(u.id));
  if (exploiting) return { ok: false, error: `${exploiting.id} moved into a Breakthrough hex: it exploits, and takes no part in ordinary combat (spec 16 AER13).` };
  const pool = attackerPool(ctx, state, state.activeSide, rec.attacked);
  const bad = units.find((u) => !pool.includes(u));
  if (bad) return { ok: false, error: `${bad.id} cannot attack: it must be a ground unit of the ${state.activeSide} side in play that has not attacked this turn.` };
  const far = units.find((u) => !crossable(ctx, u.at, action.target));
  if (far) return { ok: false, error: `${far.id} at ${far.at} is not next to ${action.target} across a hexside ground units may attack over.` };
  if (!attackHexAllowed(rec.targets, action.target)) return { ok: false, error: `${action.target} has already been attacked this turn.` };
  if (!frontAllowsAttack(ctx, state, state.activeSide, target.front)) return { ok: false, error: `The ${state.activeSide} side may not attack on the ${target.front} front now.` };
  return fight(ctx, state, units, action.target, false);
}

/**
 * The battle itself, once the attackers and the hex are known to be legal: ordinary at step 7h (the attackers join the used list and the hex the attacked hexes) or
 * Exploitation at step 7o (the attackers are marked in their Breakthrough group instead, spec 16 R13, AER17; the event says so).
 */
export function fight(ctx: GameContext, state: GameState, units: readonly Unit[], target: HexId, exploit: boolean): ActionResult {
  const rec = combatOf(state);
  const ids = units.map((u) => u.id);
  // Spec 15 R4: an attack on a hex of the minor meets the declarer's duty, whatever the roll (the attack is made).
  const stamp = (s0: GameState): GameState => {
    const s = noteMinorEntry(ctx, s0, units, [target]);
    return exploit
      ? { ...s, combat: { ...rec, targets: [...rec.targets, target] }, exploit: markExploitAttackers(exploitOf(s), ids) }
      : { ...s, combat: { ...rec, attacked: [...rec.attacked, ...ids], targets: [...rec.targets, target] } };
  };
  const tag = exploit ? { exploitation: true as const } : {};
  const defenders = defendersAt(state, units, target);
  if (defenders.length === 0) {
    // Only air units, fleets or the like (ALONE_NONGROUND_DESTROYED): the attack needs no roll; air and the like are destroyed, fleets are driven out to a friendly port (capture.ts).
    const loners = lonersAt(state, units, target);
    if (loners.length === 0) return { ok: false, error: `${target} holds no enemy ground unit to attack.` };
    const swept = applySweep(ctx, stamp(state), units, target);
    const factors = units.reduce((n, u) => n + u.strength, 0);
    return { ok: true, state: swept.state, events: [{ type: "COMBAT_RESOLVED", side: state.activeSide, target, attackers: [...ids], attackFactors: factors, defenseFactors: 0, multiplier: 1, rounds: [], outcome: "defender-eliminated", sweep: true, ...tag }, ...swept.events] };
  }

  const numbers = attackNumbers(ctx, state, units, defenders, target);
  const res = resolveOffensiveCombat({ attackFactors: numbers.attackFactors, defenseBasicFactors: numbers.defenseFactors, defenseMultiplier: numbers.multiplier }, state.rngState);
  const marked: GameState = { ...stamp(state), rngState: res.rngState };
  const applied = applyOutcome(ctx, marked, { outcome: res.outcome, side: state.activeSide, target, attackers: [...units], air: numbers.air, defenders, multiplier: numbers.multiplier });
  const event = { type: "COMBAT_RESOLVED" as const, side: state.activeSide, target, attackers: [...ids], attackFactors: numbers.attackFactors, defenseFactors: numbers.defenseFactors, multiplier: numbers.multiplier, rounds: res.rounds, outcome: res.outcome.kind, ...(numbers.airFactors > 0 ? { airFactors: numbers.airFactors } : {}), ...tag };
  return { ok: true, state: applied.state, events: [event, ...applied.events] };
}

export function applyAdvance(ctx: GameContext, state: GameState, action: AdvanceAction): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  const rec = combatOf(state);
  const exploiting = atExploitCombat(state);
  const chance = rec.advances.find((a) => a.to === action.to && (!exploiting || exploitChance(state, a.units)));
  if (!chance) return { ok: false, error: `No unit may advance into ${action.to}: it was not left empty by a battle this turn, or the advance was made.` };
  const ids = action.units;
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !chance.units.includes(id) || !Object.hasOwn(state.units, id))) {
    return { ok: false, error: `Only surviving units that attacked ${action.to} may advance into it.` };
  }
  if (exploiting) {
    // Spec 16 R13, AER18: an Exploitation advance may not break the chain; units are tried one at a time, each seeing the ones before it in the hex.
    let s = state;
    for (const id of ids) {
      const broken = exploitAdvanceProblem(ctx, s, exploitOf(state), id, action.to);
      if (broken) return { ok: false, error: broken };
      s = { ...s, units: { ...s.units, [id]: { ...s.units[id]!, at: action.to } } };
    }
  }
  const problem = advanceProblem(ctx, state, ids, action.to);
  if (problem) return { ok: false, error: problem };
  const from = [...new Set(ids.map((id) => state.units[id]!.at))];
  const units = { ...state.units };
  for (const id of ids) units[id] = { ...units[id]!, at: action.to };
  const advances = rec.advances.filter((a) => a !== chance);
  // Entering the hex can change its control (Ref 7.0; control.ts). TODO(verify): the rules text on whether an
  // advance after combat takes control the way movement does is not in the repo; this applies the same rule.
  const moves = movesOf(state); // spec 16 R30 / AER38: advancing counts as moving for fortress supply.
  let next: GameState = { ...state, units, combat: { ...rec, advances }, moves: { ...moves, moved: [...new Set([...moves.moved, ...ids])] } };
  const events: GameEvent[] = [{ type: "UNITS_ADVANCED", units: [...ids], from, to: action.to }];
  for (const id of ids) {
    const entered = enterHexes(ctx, next, next.units[id]!, [action.to]);
    next = entered.state;
    events.push(...entered.events);
  }
  // A won attack with armor in it, advanced into: the hex is a Breakthrough hex (Ref 12.31; spec 16 R10).
  if (!exploiting && breakthroughAfter(chance)) { // an Exploitation advance is not a new Breakthrough (spec 16 R13)
    const opened = openBreakthrough(ctx, next, chance);
    next = opened.state;
    events.push(...opened.events);
  }
  return { ok: true, state: next, events };
}
