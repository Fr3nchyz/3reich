import type { Action, ActionResult, GameEvent } from "./action-types";
import { applyAirBreakDown } from "./air-breakdown";
import { portAttackProblem, portCounterAirDefenders, resolvePortAttack, type PortAttackResult, type PortFleetLossChooser } from "./air-port-attack";
import { airOf, markFlown } from "./air-record";
import { frontAllowsAttack } from "./attack-rules";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import { navalOf } from "./naval-record";
import { eliminateUnits } from "./losses";
import type { GameState } from "./types";

/** TODO(verify) AER80: explicit queued work only, spec 12 Wiring, 12-15b / R14. */
export const PORT_ATTACK_STEP = "7i";
/** TODO(verify) AER82: automatic nominal fleet losses, smallest strength then lexical id. */
export const PORT_FLEET_LOSS_ORDER = "strength-id";
export const portAttacksOf = (state: GameState) => airOf(state).portAttacks ?? [];
export const hasPortAttackWork = (state: GameState): boolean => portAttacksOf(state).some((m) => m.units.length > 0);
export const legalPortAttacks = (state: GameState): Action[] => hasPortAttackWork(state) ? [{ type: "RESOLVE_PORT_ATTACKS", side: state.activeSide }] : [];

/** Spec 12 R14/R19, AER80: validate direct designation; never enumerate for the computer. */
export function applyPortDesignation(ctx: GameContext, state: GameState, action: Extract<Action, { type: "DESIGNATE_AIR" }>): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: "Only the phasing side designates port attacks." };
  if (typeof action.target !== "string" || !Object.hasOwn(ctx.map.hexes, action.target)) return { ok: false, error: "A port attack needs a target on the map." };
  if (!Array.isArray(action.units) || action.units.length === 0 || action.units.length > 100 ||
    Array.from(action.units).some((id) => typeof id !== "string" || !Object.hasOwn(state.units, id)) || new Set(action.units).size !== action.units.length) return { ok: false, error: "A port attack names distinct air units on the map." };
  for (const id of action.units) {
    const problem = portAttackProblem(ctx, state, [], id, action.target);
    if (problem) return { ok: false, error: problem };
  }
  if (!frontAllowsAttack(ctx, state, state.activeSide, ctx.map.hexes[action.target]!.front)) return { ok: false, error: "The target Front does not allow port attacks." };
  const missions = portAttacksOf(state);
  const previous = missions.find((m) => m.target === action.target);
  const portAttacks = previous ? missions.map((m) => m === previous ? { ...m, units: [...m.units, ...action.units] } : m)
    : [...missions, { target: action.target, units: [...action.units] }];
  const flown = markFlown(state, action.units, "port-attack");
  return { ok: true, state: { ...flown, air: { ...airOf(flown), portAttacks } },
    events: [{ type: "AIR_MISSION_DESIGNATED", mission: "port-attack", units: [...action.units], target: action.target }] };
}

/** TODO(verify) AER82 / N29: owner choice deferred; allocation itself remains explicit to the pure resolver. */
export const chooseFleetLosses: PortFleetLossChooser = (pool, owed) => {
  let left = owed;
  return [...pool].sort((a, b) => a.strength - b.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).flatMap((u) => {
    const factors = Math.min(left, u.strength);
    left -= factors;
    return factors > 0 ? [{ id: u.id, factors }] : [];
  });
};

/** Spec 12 R14 / Ref 21.7; TODO(verify) AER83: preserve survivors, route whole sinks, discard partial factors (RB5). */
export function applyPortLosses(state: GameState, attacker: readonly string[], result: PortAttackResult, inheritNaval = false): { state: GameState; events: GameEvent[] } | { problem: string } {
  const remaining = new Map(result.air.surviving.map((u) => [u.id, u.strength]));
  const take = attacker.flatMap((id) => {
    const factors = state.units[id]!.strength - (remaining.get(id) ?? 0);
    return factors > 0 ? [{ id, factors }] : [];
  });
  const air = applyAirBreakDown(state, take, take.reduce((n, t) => n + t.factors, 0));
  if ("problem" in air) return air;
  let next = air.state;
  const events = [...air.events];
  for (const fleet of result.fleets) {
    if (fleet.lost === 0) continue;
    const unit = next.units[fleet.id]!;
    if (fleet.counters.length === 0) {
      const gone = eliminateUnits(next, [fleet.id]);
      next = gone.state;
      events.push(...gone.events);
    } else {
      const units = { ...next.units, [unit.id]: { ...unit, strength: fleet.counters[0]! } };
      let nextUnitId = next.nextUnitId;
      for (const strength of fleet.counters.slice(1)) {
        let id = `u${nextUnitId++}`;
        if (inheritNaval) while (Object.hasOwn(units, id)) id = `u${nextUnitId++}`;
        units[id] = { ...unit, id, strength };
      }
      const replacements = Object.keys(units).filter(id => !Object.hasOwn(next.units, id));
      next = { ...next, units, nextUnitId };
      // TODO(verify) AER102: replacement ships retain sea-force membership and ledger marks.
      if (inheritNaval) {
        const rec = navalOf(next);
        const ids = [unit.id, ...replacements];
        next = { ...next, naval: { ...rec,
          used: { ...rec.used, ...Object.fromEntries(ids.flatMap(id => rec.used[unit.id] ? [[id, rec.used[unit.id]!]] : [])) },
          moved: [...new Set([...rec.moved, ...(rec.moved.includes(unit.id) ? ids : [])])],
          triedIntercept: [...new Set([...rec.triedIntercept, ...(rec.triedIntercept.includes(unit.id) ? ids : [])])],
          seaAirForces: Object.fromEntries(Object.entries(rec.seaAirForces ?? {}).map(([key, members]) => [key, members.flatMap(id => id === unit.id ? ids : [id])])),
        } };
      }
      events.push({ type: "UNIT_LOST_FOR_GOOD", unitId: unit.id, owner: unit.owner, unitType: "fleet", at: unit.at, strength: fleet.lost, reason: "partial-fleet" });
    }
  }
  return { state: next, events };
}

/** Spec 12 R14/R21, AER80–79: resolve current targets once, in designation order, after ground combat. */
export function applyResolvePortAttacks(state: GameState, action: Extract<Action, { type: "RESOLVE_PORT_ATTACKS" }>): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: "Only the phasing side resolves port attacks." };
  if (!hasPortAttackWork(state)) return { ok: false, error: "No port attack is assigned." };
  let next = state;
  const events: GameEvent[] = [];
  for (const mission of portAttacksOf(state)) {
    const attacker = mission.units.flatMap((id) => Object.hasOwn(next.units, id) ? [next.units[id]!] : []);
    if (attacker.some((u) => u.type !== "air" || sideInWar(next, u.owner) !== state.activeSide)) return { ok: false, error: "Port attacks need their assigned phasing planes." };
    if (attacker.length === 0) {
      events.push({ type: "PORT_ATTACK_RESOLVED", target: mission.target, status: "no-air", rolls: [], airLost: 0, navalHits: 0, navalLost: 0, fleets: [] });
      continue;
    }
    // TODO(verify) AER124: absent a result, currently unflown planes block at 7i; DAS can expose the port.
    // AER81: recorded Counter-Air failure remains blocking after the defenders use their mission.
    const counterAir = mission.counterAir ?? (portCounterAirDefenders(next, mission.target).length > 0 ? "not-beaten" : "not-needed");
    const fleets = Object.values(next.units).filter((u) => u.type === "fleet" && u.strength > 0 && u.at === mission.target && sideInWar(next, u.owner) === (state.activeSide === "axis" ? "allies" : "axis"))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const result = resolvePortAttack({ target: mission.target, attacker, fleets, counterAir, rngState: next.rngState }, chooseFleetLosses);
    const losses = applyPortLosses(next, attacker.map((u) => u.id), result);
    if ("problem" in losses) return { ok: false, error: losses.problem };
    next = { ...losses.state, rngState: result.rngState };
    events.push({ type: "PORT_ATTACK_RESOLVED", target: mission.target, status: result.status, rolls: result.rolls,
      airLost: result.air.lost, navalHits: result.navalHits, navalLost: result.navalLost, fleets: result.fleets }, ...losses.events);
  }
  return { ok: true, state: { ...next, air: { ...airOf(next), portAttacks: [] } }, events };
}
