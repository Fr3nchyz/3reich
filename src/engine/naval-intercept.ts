import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { areEnemies, sideInWar } from "./control";
import { otherSide } from "./game";
import { parseHexId, type HexId } from "./hex";
import { eliminateUnits } from "./losses";
import { resolveNavalCombat, type NavalForce } from "./naval-combat";
import { displaceFleets } from "./naval-displace";
import { breakDownFleet } from "./naval-losses";
import { portFronts } from "./naval-ports";
import { fleetMayAct, navalOf } from "./naval-record";
import { baseChangeRoute } from "./naval-routes";
import { stackingProblem } from "./placement";
import { rollD6 } from "./rng";
import { interceptionRolls, type NavalNation } from "./tables";
import type { Front } from "./map";
import type { GameState, Side } from "./types";

/** TODO(verify) AER76/AER79, spec 12 Wiring 12-12, R11 (Ref 21.5). */
export const INTERCEPT_PASSES = 2;
export const INTERCEPT_DISTANCE = "shortest-legal-sea-route";
/** TODO(verify) AER81/AER82: deterministic losses; omitted withdrawal choices fight/continue. */
export const INTERCEPT_LOSS_ORDER = "strength-then-id";
export const INTERCEPT_BREAK_OFF = false;
export const INTERCEPT_TURN_BACK: readonly string[] = [];

export interface Interception {
  id: string;
  side: Side;
  target: string;
  fleets: string[];
  meetingPoint: HexId;
  front: Front;
  path: HexId[];
  breakOff: boolean;
}
export interface InterceptDeclaration { side: Side; target: string; fleets: string[]; meetingPoint: HexId; breakOff?: boolean }
interface Target { id: string; side: Side; fleets: string[]; front: Front; path: HexId[] }

/** Spec 12 R11 / AER75/AER77: no new work without opt-in and a current MOVE_FLEET course. */
export const interceptEnabled = (state: GameState): boolean => state.naval?.manualFleetMove === true && (navalOf(state).moves ?? []).some(m => m.path.length > 0);
export const interceptionsOf = (state: GameState): Interception[] => navalOf(state).interceptions ?? [];
export const interceptSide = (state: GameState): Side => navalOf(state).interceptSide ?? otherSide(state.activeSide);
export const interceptPasses = (state: GameState): number => navalOf(state).interceptPasses ?? 0;

/** TODO(verify) AER78: stable indices, one combined force per target, courses include endpoints. */
export function interceptTargets(state: GameState): Target[] {
  return [...(navalOf(state).moves ?? []).map((m, i) => ({ id: `move:${i}`, side: state.activeSide, fleets: [m.fleet], front: m.front, path: m.path })),
    ...interceptionsOf(state).map(m => ({ id: m.id, side: m.side, fleets: m.fleets, front: m.front, path: m.path }))];
}

/** Spec 12 R11, N23/N24; TODO(verify) AER79: distance in hexsides, including state-aware straits. */
export function interceptionCourse(ctx: GameContext, state: GameState, side: Side, front: Front, base: HexId, point: HexId): HexId[] | null {
  return baseChangeRoute(ctx, state, side, front, base, point);
}

/** Spec 12 R5/R11 (Ref 21.3/21.5); TODO(verify) AER77/AER78: validate before any dice or mutation. */
export function interceptProblem(ctx: GameContext, state: GameState, d: InterceptDeclaration): string | null {
  if (!interceptEnabled(state)) return "Interception needs manual fleet movement and a recorded course (AER77).";
  if (d.side !== interceptSide(state) || interceptPasses(state) >= INTERCEPT_PASSES) return "It is not this side's interception round (Ref 21.5).";
  const target = interceptTargets(state).find(t => t.id === d.target);
  if (!target || target.side === d.side) return "Interception needs an opposing move or earlier interception (Ref 21.5).";
  if (!Array.isArray(d.fleets) || !d.fleets.length || Array.from(d.fleets).some(id => typeof id !== "string" || !Object.hasOwn(state.units, id)) || new Set(d.fleets).size !== d.fleets.length) return "Name distinct fleets on the map (Ref 21.5).";
  if (typeof d.meetingPoint !== "string" || !target.path.includes(d.meetingPoint)) return "The meeting point must lie on the target course (Ref 21.5).";
  if (d.breakOff !== undefined && typeof d.breakOff !== "boolean") return "Break-off must be a boolean (AER82).";
  const rec = navalOf(state), declarations = interceptionsOf(state);
  const previous = declarations.find(i => i.target === d.target);
  if (previous && (previous.meetingPoint !== d.meetingPoint || previous.breakOff !== (d.breakOff ?? INTERCEPT_BREAK_OFF))) return "One target has one meeting point and break-off choice (Ref 21.5; AER78/AER82).";
  if (previous && declarations.some(i => i.target === previous.id)) return "A counter-targeted force is sealed (AER78).";
  const victims = target.fleets.map(id => state.units[id]);
  if (victims.some(u => !u || u.type !== "fleet" || ["supply", "escort"].includes(rec.used[u.id] ?? "") || rec.supply.some(s => s.fleets.includes(u.id)))) return "Supply and escort fleets cannot be intercepted (Ref 21.5).";
  for (const id of d.fleets) {
    const u = state.units[id]!;
    if (u.type !== "fleet" || sideInWar(state, u.owner) !== d.side || victims.some(v => !v || !areEnemies(state, u.owner, v.owner))) return "Only hostile fleets of the acting side can intercept (Ref 21.5).";
    if (!fleetMayAct(state, id) || rec.moved.includes(id) || rec.triedIntercept.includes(id) || rec.supply.some(s => s.fleets.includes(id)) || declarations.some(i => i.fleets.includes(id))) return "A fleet must be free, unmoved, unsupplying and untried (Ref 21.3/21.5).";
    if (!portFronts(ctx, u.at).includes(target.front) || !interceptionCourse(ctx, state, d.side, target.front, u.at, d.meetingPoint)) return "Interceptors need a base and a sea course on the target Front (Ref 21.5; N23/N24).";
    if (declarations.some(i => i.side === d.side && i.target !== d.target && i.fleets.some(f => state.units[f]?.at === u.at))) return "Fleets from one base must intercept the same target (Ref 21.5).";
  }
  return null;
}

/** Spec 12 R11/R13 / AER78: append into a combined force without aliasing action arrays. */
export function declareIntercept(ctx: GameContext, state: GameState, d: InterceptDeclaration): GameState {
  const rec = navalOf(state), list = interceptionsOf(state), target = interceptTargets(state).find(t => t.id === d.target)!;
  const previous = list.find(i => i.target === d.target);
  const fleets = [...(previous?.fleets ?? []), ...d.fleets];
  const path = [...new Set(fleets.flatMap(id => interceptionCourse(ctx, state, d.side, target.front, state.units[id]!.at, d.meetingPoint)!))];
  const item: Interception = { id: previous?.id ?? `intercept:${list.length}`, side: d.side, target: d.target, fleets, meetingPoint: d.meetingPoint, front: target.front, path, breakOff: d.breakOff ?? INTERCEPT_BREAK_OFF };
  return { ...state, naval: { ...rec, interceptions: previous ? list.map(i => i === previous ? item : i) : [...list, item], interceptPasses: 0 } };
}

/** TODO(verify) AER81: deterministic smaller-strength then id allocation; R1/R12.6 break-down. */
function lose(state: GameState, ids: readonly string[], owed: number): { state: GameState; events: GameEvent[]; survivors: string[] } {
  let next = { ...state }, left = owed;
  const events: GameEvent[] = [], survivors: string[] = [];
  for (const u of ids.map(id => state.units[id]!).filter(Boolean).sort((a, b) => a.strength - b.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const debt = Math.min(left, u.strength);
    if (!debt) { survivors.push(u.id); continue; }
    const parts = breakDownFleet(u.strength, debt);
    left -= parts.lost;
    if (!parts.counters.length) {
      const gone = eliminateUnits(next, [u.id]); next = gone.state; events.push(...gone.events); continue;
    }
    const units = { ...next.units }, rec = navalOf(next);
    const used = { ...rec.used }, moved = [...rec.moved], triedIntercept = [...rec.triedIntercept];
    const after = parts.counters.map((strength, i) => {
      let id = u.id;
      if (i > 0) { do { id = `u${next.nextUnitId++}`; } while (Object.hasOwn(units, id)); }
      units[id] = { ...u, id, strength }; survivors.push(id);
      if (rec.used[u.id]) used[id] = rec.used[u.id]!;
      if (i > 0 && rec.moved.includes(u.id)) moved.push(id);
      if (i > 0 && rec.triedIntercept.includes(u.id)) triedIntercept.push(id);
      return { id, strength };
    });
    next = { ...next, units, naval: { ...rec, used, moved, triedIntercept } };
    events.push({ type: "NAVAL_LOSSES_APPLIED", side: sideInWar(state, u.owner)!, at: u.at, before: { id: u.id, strength: u.strength }, after, lost: parts.lost });
  }
  return { state: next, events, survivors };
}

/** Spec 12 R11/R12/R21 / AER79/AER80: last declared first, base dice then combat dice. */
export function resolveInterceptions(ctx: GameContext, state: GameState, turnBack: readonly string[] = INTERCEPT_TURN_BACK): { state: GameState; events: GameEvent[] } {
  let next = { ...state };
  const events: GameEvent[] = [], cancelled = new Set<string>();
  const forces = new Map(interceptTargets(state).map(t => [t.id, [...t.fleets]]));
  const live = (id: string) => (forces.get(id) ?? []).filter(f => next.units[f]);
  const force = (ids: string[], mayBreakOff: boolean): NavalForce => ({ factors: ids.reduce((n, id) => n + next.units[id]!.strength, 0), nationalities: ids.map(id => (next.units[id]!.nationality ?? next.units[id]!.owner) as NavalNation), mayBreakOff });
  const returning = new Set<string>();
  for (const m of [...interceptionsOf(state)].reverse()) {
    if (cancelled.has(m.id) || cancelled.has(m.target) || !live(m.id).length || !live(m.target).length) {
      events.push({ type: "INTERCEPTION_CANCELLED", side: m.side, interception: m.id }); continue;
    }
    const participants: string[] = [], failed: string[] = [];
    const bases = [...new Set(live(m.id).map(id => next.units[id]!.at))].sort();
    for (const base of bases) {
      const ids = live(m.id).filter(id => next.units[id]!.at === base);
      const course = interceptionCourse(ctx, next, m.side, m.front, base, m.meetingPoint);
      const distance = course ? course.length - 1 : null;
      const needed = distance === null ? [] : interceptionRolls(distance);
      const die = needed === "automatic" ? null : rollD6(next.rngState);
      if (die) next = { ...next, rngState: die.state };
      const success = needed === "automatic" || (die !== null && needed.includes(die.roll));
      (success ? participants : failed).push(...ids);
      events.push({ type: "INTERCEPTION_ATTEMPTED", side: m.side, interception: m.id, fleets: ids, base, distance, die: die?.roll ?? null, needed, success });
    }
    let rec = navalOf(next);
    next = { ...next, naval: { ...rec, triedIntercept: [...new Set([...rec.triedIntercept, ...failed])], used: { ...rec.used, ...Object.fromEntries(participants.map(id => [id, "intercept" as const])) } } };
    if (!participants.length) continue;
    const targetIds = live(m.target), a = rollD6(next.rngState), b = rollD6(a.state);
    const combat = resolveNavalCombat(force(participants, true), force(targetIds, false), { interceptor: a.roll, intercepted: b.roll }, { breakOff: m.breakOff, battleNorthOfRowN: parseHexId(m.meetingPoint)!.r < parseHexId("N1")!.r });
    next = { ...next, rngState: b.state };
    events.push({ type: "NAVAL_COMBAT_RESOLVED", interception: m.id, at: m.meetingPoint, interceptor: [...participants], intercepted: [...targetIds], dice: { interceptor: a.roll, intercepted: b.roll }, result: combat });
    const lostA = lose(next, participants, combat.interceptor.loss); next = lostA.state; events.push(...lostA.events);
    const lostB = lose(next, targetIds, combat.intercepted.loss); next = lostB.state; events.push(...lostB.events);
    forces.set(m.id, [...live(m.id).filter(id => !participants.includes(id)), ...lostA.survivors]); forces.set(m.target, lostB.survivors);
    // Ref 21.51 / AER80: an interceptor defeated as a target never makes its earlier attempt.
    if (combat.winner === "interceptor") { cancelled.add(m.target); if (m.target.startsWith("move:")) returning.add(m.target); }
    // AER82: all interceptor survivors remain at base; intercepted moving winners continue unless told otherwise.
    rec = navalOf(next);
    next = { ...next, naval: { ...rec, used: { ...rec.used, ...Object.fromEntries(lostA.survivors.map(id => [id, "intercept" as const])) } } };
  }
  for (const [i, move] of (navalOf(state).moves ?? []).entries()) {
    const target = `move:${i}`;
    if (!returning.has(target) && !turnBack.includes(target)) continue;
    for (const id of live(target)) {
      const u = next.units[id]!;
      next = { ...next, units: { ...next.units, [id]: { ...u, at: move.from } } };
      events.push({ type: "FLEET_RETURNED", side: state.activeSide, unit: id, from: move.to, to: move.from });
      // Spec 12 C1/R9: overflow on returning uses the existing nearest-port policy.
      const spec = { type: u.type, strength: u.strength, ...(u.nationality ? { nationality: u.nationality } : {}) };
      const { [id]: _self, ...others } = next.units;
      if (stackingProblem(ctx, { ...next, units: others }, u.owner, spec, move.from) !== null) {
        const displaced = displaceFleets(ctx, next, move.from, [next.units[id]!]); next = displaced.state; events.push(...displaced.events);
      }
    }
  }
  return { state: { ...next, naval: { ...navalOf(next), interceptsResolved: true } }, events };
}
