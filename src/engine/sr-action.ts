import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { srOf } from "./sr-record";
import { srDestinations, srProblem, srView, type SrSoFar, type SrView } from "./sr-region";
import { srLeft, srNationOf, srUnitCost, SR_UNIT_TYPES } from "./sr-rules";
import type { GameState, PowerId, Unit } from "./types";

/**
 * SR_UNITS at step 9e (spec 16 R18 to R20, C3, C5; Ref 11.72, Ops 5.48e): the side to move redeploys ground units and Replacements, one use
 * of their nation's allowance each, to any hex of the region they can reach (sr-region.ts). The step waits only while some unit of the
 * side can still be redeployed; redeploying is optional, so END_STEP stays legal there (actions.ts adds it, as at 6f).
 * Not here: grants (16-18), Sea Escort (16-21), air units, airbases and fleets (16-22, 16-23), the computer's policy (16-20).
 */

type Redeploy = Extract<Action, { type: "SR_UNITS" }>;

/** The step that waits for this action. */
export const SR_STEP = "9e";

/** The allowances used and the units already redeployed this Player Turn, as `srProblem` reads them. */
const soFar = (state: GameState): SrSoFar => ({ used: srOf(state).used, redeployed: srOf(state).moved });

/** The side's units that could be redeployed, in id order (a cheap filter; `srDestinations` has the final say). */
const candidates = (state: GameState): Unit[] =>
  Object.values(state.units)
    .filter((u) => SR_UNIT_TYPES.includes(u.type) && srNationOf(state, u) !== null)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

/** Whether any unit of the side to move can be redeployed to some hex: the step waits only while this is true. */
export function hasSrWork(ctx: GameContext, state: GameState): boolean {
  const view = srView(ctx, state);
  const so = soFar(state);
  return candidates(state).some((u) => srDestinations(ctx, state, u, so, view).length > 0);
}

const listed = new WeakMap<GameState, WeakMap<GameContext, Action[]>>();

/** Units of one owner that stand in one hex and have a place to go, in hex order: one stack. */
function groups(units: readonly Unit[]): Unit[][] {
  const by = new Map<string, Unit[]>();
  for (const u of units) by.set(`${u.at}|${u.owner}`, [...(by.get(`${u.at}|${u.owner}`) ?? []), u]);
  return [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, us]) => us);
}

function computeSr(ctx: GameContext, state: GameState): Action[] {
  const side = state.activeSide;
  const view: SrView = srView(ctx, state);
  const so = soFar(state);
  const dests = new Map<string, HexId[]>();
  for (const u of candidates(state)) {
    const d = srDestinations(ctx, state, u, so, view);
    if (d.length > 0) dests.set(u.id, d);
  }
  // Spec 16 C3 / B5: a list of every unit and every subset to every hex is far over the size an iPad can take (about 35,000 actions in a 1944 position), so the list
  // holds the stack-level actions only: the whole stack of a hex, or the units of it that can go together, to each hex all of them can reach. Any subset
  // or single unit is still accepted by `applySr` (it checks `srProblem`), and `srDestinations` answers where one unit can go.
  const out: Action[] = [];
  for (const group of groups([...dests.keys()].map((id) => state.units[id]!))) {
    const ids = group.map((u) => u.id);
    for (const to of dests.get(ids[0]!)!) {
      if (ids.every((id) => dests.get(id)!.includes(to)) && (ids.length === 1 || srProblem(ctx, state, ids, to, so, view) === null)) out.push({ type: "SR_UNITS", side, units: ids, to });
    }
  }
  return out;
}

/**
 * The redeployments the side may make now, at stack level: each stack (the units of one owner in one hex) to each hex all of it can reach, a lone
 * unit being a stack of one; a subset is not listed but is accepted. Computed once per state and context (a state is never changed), however often the screen and the computer ask.
 */
export function legalSr(ctx: GameContext, state: GameState): Action[] {
  const hit = listed.get(state)?.get(ctx);
  if (hit) return hit;
  const out = computeSr(ctx, state);
  listed.set(state, (listed.get(state) ?? new WeakMap()).set(ctx, out));
  return out;
}

/** Redeploys the units: refused unless it is the side's own turn and `srProblem` finds nothing. Records the use and the units; no control changes (the way is the side's own). */
export function applySr(ctx: GameContext, state: GameState, action: Redeploy): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  if (!Array.isArray(action.units) || action.units.some((id) => typeof id !== "string") || typeof action.to !== "string") return { ok: false, error: "SR_UNITS needs a list of unit ids and a destination hex." };
  if (action.escort !== undefined) return { ok: false, error: "Redeployment across the sea by Sea Escort is not built yet." };
  const problem = srProblem(ctx, state, action.units, action.to, soFar(state));
  if (problem) return { ok: false, error: problem };
  const units = action.units.map((id) => state.units[id]!);
  const rec = srOf(state);
  const used = { ...rec.used };
  for (const [power, n] of Object.entries(srUnitCost(state, units)) as [PowerId, number][]) used[power] = (used[power] ?? 0) + n;
  const next: GameState = {
    ...state,
    units: { ...state.units, ...Object.fromEntries(units.map((u) => [u.id, { ...u, at: action.to }])) },
    sr: { ...rec, used, moved: [...rec.moved, ...units.map((u) => u.id)] },
  };
  // One event for each nation and starting hex, so every event names one nation and one place the units left.
  const events: GameEvent[] = [];
  const seen = new Set<string>();
  for (const u of units) {
    const nation = srNationOf(state, u)!;
    if (seen.has(`${nation}|${u.at}`)) continue;
    seen.add(`${nation}|${u.at}`);
    const same = units.filter((v) => srNationOf(state, v) === nation && v.at === u.at).map((v) => v.id);
    events.push({ type: "UNITS_REDEPLOYED", units: same, from: u.at, to: action.to, nation, left: srLeft(used, nation) });
  }
  return { ok: true, state: next, events };
}
