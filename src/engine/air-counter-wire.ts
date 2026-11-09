import type { Action, ActionResult, GameEvent } from "./action-types";
import { frontAllowsAttack } from "./attack-rules";
import { airCapacity } from "./air-bases";
import { applyAirBreakDown } from "./air-breakdown";
import { resolveCounterAir } from "./air-counter";
import { autoAirLosses } from "./air-losses";
import { airOf, hasFlown, markFlown } from "./air-record";
import { missionHexes } from "./air-range";
import type { GameContext } from "./context";
import { areEnemies, sideInWar } from "./control";
import type { GameState, Unit } from "./types";

/** TODO(verify) AER73: explicit resolution at 7c, only after assignment (spec 09 Wiring, 09-9b). */
export const COUNTER_AIR_STEP = "7c";
/** TODO(verify) AER74: automatic deterministic allocation; owner choice remains open (spec 09 Wiring, 09-9b). */
export const COUNTER_AIR_LOSS_CHOOSER = autoAirLosses;

/** Ref 20.42 / spec 09 C1: assignments retain designation order, one combat per target. */
export const counterAirOf = (state: GameState) => airOf(state).counterAir ?? [];
export const hasCounterAirWork = (state: GameState): boolean => counterAirOf(state).some((m) => m.units.length > 0);
export const legalCounterAir = (state: GameState): Action[] => hasCounterAirWork(state) ? [{ type: "RESOLVE_COUNTER_AIR", side: state.activeSide }] : [];

/** Spec 09 R12: based enemies, including already-flown planes that can suffer spillover. */
function defenders(ctx: GameContext, state: GameState, attacker: Unit, target: string): Unit[] {
  return airCapacity(ctx, state, target) > 0 ? Object.values(state.units)
    .filter((u) => u.type === "air" && u.at === target && areEnemies(state, attacker.owner, u.owner)) : [];
}

/** Spec 09 R12/R14: designate directly at 7b; never enumerate this mission for the computer. */
export function applyCounterAirDesignation(ctx: GameContext, state: GameState, action: Extract<Action, { type: "DESIGNATE_AIR" }>): ActionResult {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "7b") return { ok: false, error: "Counter-air is designated at step 7b." };
  if (action.side !== state.activeSide) return { ok: false, error: "Only the phasing side designates counter-air." };
  if (typeof action.target !== "string" || !Object.hasOwn(ctx.map.hexes, action.target)) return { ok: false, error: "Counter-air needs a target on the map." };
  if (!Array.isArray(action.units) || action.units.length === 0 || action.units.length > 100 ||
    Array.from(action.units).some((id) => typeof id !== "string" || !Object.hasOwn(state.units, id)) || new Set(action.units).size !== action.units.length) return { ok: false, error: "Counter-air names distinct air units on the map." };
  const units = action.units.map((id) => state.units[id]!);
  for (const u of units) {
    if (u.type !== "air" || sideInWar(state, u.owner) !== state.activeSide || hasFlown(state, u.id)) return { ok: false, error: "Counter-air needs the phasing side's air that has not flown or been built this Game Turn (Ref 20.3)." };
    if (!Object.hasOwn(ctx.map.hexes, u.at) || !missionHexes(ctx, state, u.owner, u.at).includes(action.target)) return { ok: false, error: "Counter-air flies at most four hexes and cannot cross neutral land (Ref 20.2)." };
    if (defenders(ctx, state, u, action.target).length === 0) return { ok: false, error: "Counter-air attacks enemy planes based at a city or airbase (Ref 20.42)." };
  }
  // Spec 09 R14: retain the existing ordinary-attack Option hook, without changing computer play.
  if (!frontAllowsAttack(ctx, state, state.activeSide, ctx.map.hexes[action.target]!.front)) return { ok: false, error: "The target Front does not allow counter-air." };
  const rec = airOf(state);
  const missions = counterAirOf(state);
  const previous = missions.find((m) => m.target === action.target);
  const counterAir = previous ? missions.map((m) => m === previous ? { ...m, units: [...m.units, ...action.units] } : m)
    : [...missions, { target: action.target, units: [...action.units] }];
  const flown = markFlown(state, action.units, "counter-air");
  return { ok: true, state: { ...flown, air: { ...rec, counterAir } },
    events: [{ type: "AIR_MISSION_DESIGNATED", mission: "counter-air", units: [...action.units], target: action.target }] };
}

/** Spec 09 R7/R12/R15, AER73/AER74: resolve once in designation order with automatic losses. */
export function applyResolveCounterAir(ctx: GameContext, state: GameState, action: Extract<Action, { type: "RESOLVE_COUNTER_AIR" }>): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: "Only the phasing side resolves counter-air." };
  if (!hasCounterAirWork(state)) return { ok: false, error: "No counter-air mission is assigned." };
  let next = state;
  const events: GameEvent[] = [];
  for (const mission of counterAirOf(state)) {
    const attacker = mission.units.map((id) => next.units[id]!);
    const based = attacker[0] ? defenders(ctx, next, attacker[0], mission.target) : [];
    if (attacker.some((u) => !u || u.type !== "air") || attacker.length === 0 || based.length === 0) return { ok: false, error: "Counter-air needs its assigned attackers and based enemy defenders." };
    const result = resolveCounterAir({ target: mission.target, attacker,
      defender: based.filter((u) => !hasFlown(next, u.id)), nonParticipating: based.filter((u) => hasFlown(next, u.id)), rngState: next.rngState },
    (_side, pool, owed) => COUNTER_AIR_LOSS_CHOOSER(pool, owed));
    // Ref 20.6 / spec 17 R3: route actual reductions through the shared pool-return path.
    const remaining = new Map([...result.attacker.surviving, ...result.defender.surviving].map((u) => [u.id, u.strength]));
    const take = [...attacker, ...based].flatMap((u) => {
      const factors = u.strength - (remaining.get(u.id) ?? 0);
      return factors > 0 ? [{ id: u.id, factors }] : [];
    });
    const losses = applyAirBreakDown(next, take, take.reduce((sum, t) => sum + t.factors, 0));
    if ("problem" in losses) return { ok: false, error: losses.problem };
    next = markFlown({ ...losses.state, rngState: result.rngState }, [...result.attacker.aborted, ...result.defender.aborted], "counter-air");
    events.push(...result.events, ...losses.events);
  }
  // AER73: consuming the queue prevents a repeated action from rolling again.
  return { ok: true, state: { ...next, air: { ...airOf(next), counterAir: [] } }, events };
}
