import type { Action, ActionResult } from "./action-types";
import { applyAirBreakDown } from "./air-breakdown";
import { dasOf, manualDas } from "./air-defense-wire";
import { interceptProblem, interceptors, resolveInterception, type InterceptionResult } from "./air-intercept";
import { autoAirLosses } from "./air-losses";
import { airOf, markFlown } from "./air-record";
import type { GameContext } from "./context";
import type { GameState } from "./types";

/** TODO(verify) AER84: explicit optional exchange at 7e, with manual DAS only. */
export const DAS_INTERCEPT_STEP = "7e";
/** TODO(verify) AER85: automatic deterministic allocation, following counter-air. */
export const DAS_INTERCEPT_LOSSES = autoAirLosses;
/** TODO(verify) AER86: larger-winning DAS automatically continues; owner choice deferred. */
export const DAS_CONTINUES = true;

/** Spec 09 C3/R11: both forces' actual losses and the remaining commitment. */
export interface InterceptionEvent {
  type: "DAS_INTERCEPTED";
  hex: string;
  rolls: InterceptionResult["rolls"];
  combat: InterceptionResult["combat"];
  lost: { interceptors: number; support: number };
  continuing: string[];
}

const record = (state: GameState) => ({ das: dasOf(state), unavailable: [] });
const intercepted = (state: GameState, hex: string) => (airOf(state).interceptedDas ?? []).includes(hex);
const atInterception = (state: GameState) => manualDas(state) && state.phase === "player-turn" &&
  state.position?.part === "player-turn" && state.position.step === DAS_INTERCEPT_STEP;

/** Ref 20.43 / AER84: useful targets then eligible counters, both in lexical order. */
export function legalDasIntercept(ctx: GameContext, state: GameState): Action[] {
  if (!atInterception(state)) return [];
  return Object.keys(dasOf(state)).sort().flatMap((hex): Action[] => {
    if (intercepted(state, hex)) return [];
    const units = interceptors(ctx, state, record(state), hex);
    return units.length ? [{ type: "DESIGNATE_DAS_INTERCEPT", side: state.activeSide, units, hex }] : [];
  });
}

/** Ref 20.43/20.44, spec 09 R11/R15: validate atomically, then resolve the selected force. */
export function applyDasIntercept(ctx: GameContext, state: GameState, action: Extract<Action, { type: "DESIGNATE_DAS_INTERCEPT" }>): ActionResult {
  if (!atInterception(state)) return { ok: false, error: "Manual DAS interception requires step 7e (AER84)." };
  if (action.side !== state.activeSide) return { ok: false, error: "Only the Phasing side intercepts DAS." };
  if (typeof action.hex !== "string" || !Object.hasOwn(ctx.map.hexes, action.hex) || intercepted(state, action.hex)) return { ok: false, error: "Interception needs a current, unintercepted DAS target." };
  if (!Array.isArray(action.units) || action.units.length === 0 || action.units.length > 100 ||
    Array.from(action.units).some((id) => typeof id !== "string" || !Object.hasOwn(state.units, id)) || new Set(action.units).size !== action.units.length) return { ok: false, error: "Interception names distinct air units on the map." };
  for (const id of action.units) {
    const problem = interceptProblem(ctx, state, record(state), id, action.hex);
    if (problem) return { ok: false, error: problem };
  }
  const attackers = action.units.map((id) => state.units[id]!);
  const support = dasOf(state)[action.hex]!.map((id) => state.units[id]!);
  const result = resolveInterception({ interceptors: attackers, support, rngState: state.rngState, continueDAS: DAS_CONTINUES },
    (_side, pool, owed) => DAS_INTERCEPT_LOSSES(pool, owed));
  // Ref 20.6 / spec 17 R3: actual counter reductions use the shared pool-return path.
  const remaining = new Map([...result.interceptors.surviving, ...result.support.surviving].map((u) => [u.id, u.strength]));
  const take = [...attackers, ...support].flatMap((u) => {
    const factors = u.strength - (remaining.get(u.id) ?? 0);
    return factors > 0 ? [{ id: u.id, factors }] : [];
  });
  const losses = applyAirBreakDown(state, take, take.reduce((sum, t) => sum + t.factors, 0));
  if ("problem" in losses) return { ok: false, error: losses.problem };
  // Ref 20.3: DAS already consumed its mission at 7d; every interceptor consumes one now.
  const flown = markFlown({ ...losses.state, rngState: result.rngState }, action.units, "das-intercept");
  const rec = airOf(flown);
  const { [action.hex]: _gone, ...otherDas } = dasOf(flown);
  // AER86: continuing survivors count at 7h, but cannot be intercepted a second time.
  const das = result.continuing.length ? { ...otherDas, [action.hex]: [...result.continuing] } : otherDas;
  return { ok: true, state: { ...flown, air: { ...rec, das, interceptedDas: [...(rec.interceptedDas ?? []), action.hex] } },
    events: [{ type: "DAS_INTERCEPTED", hex: action.hex, rolls: result.rolls, combat: result.combat,
      lost: { interceptors: result.interceptors.lost, support: result.support.lost }, continuing: [...result.continuing] }, ...losses.events] };
}
