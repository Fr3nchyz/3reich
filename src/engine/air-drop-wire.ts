import type { Action, ActionResult } from "./action-types";
import { dropStart, dropTargets, dropUnits, resolveDrop, type DropRecord } from "./air-drop";
import { turnKey } from "./combat-record";
import type { GameContext } from "./context";
import type { GameState } from "./types";

/** TODO(verify) AER95: opt-in only; no computer policy sets this gate. */
export const DROP_MANUAL_DEFAULT = false;
export interface AirDropState {
  manual?: boolean;
  record?: DropRecord;
}

/** TODO(verify) AER96: take the true start, without nesting earlier drop snapshots. */
export function beginDropTurn(state: GameState, ctx: GameContext): GameState {
  if ((state.airDrop?.manual ?? DROP_MANUAL_DEFAULT) !== true) return state;
  const { airDrop } = state;
  // TODO(verify) AER125: no full-state snapshot; legacy records remain readable.
  const start = dropStart(ctx, state, airDrop?.record?.dropped ?? {});
  return { ...state, airDrop: { ...airDrop, record: { start, dropped: { ...airDrop?.record?.dropped } } } };
}

/** AER95/AER96: an old save or missing snapshot never manufactures drop work. */
function activeRecord(state: GameState): DropRecord | undefined {
  const drop = state.airDrop;
  if ((drop?.manual ?? DROP_MANUAL_DEFAULT) !== true || !drop?.record || turnKey(drop.record.start) !== turnKey(state)) return undefined;
  return drop.record;
}

/** Spec 09 R13 / AER95: explicit legal pairs, sorted by unit and then target. */
export function legalDrops(ctx: GameContext, state: GameState): Action[] {
  const record = activeRecord(state);
  if (!record) return [];
  return dropUnits(ctx, state, record).flatMap((unit) => dropTargets(ctx, state, record, unit)
    .map((to): Action => ({ type: "AIRDROP", side: state.activeSide, unit, to })));
}

/** Ref 23.1 / AER97: validate atomically and preserve the pure resolver's placement and supply report. */
export function applyDrop(ctx: GameContext, state: GameState, action: Extract<Action, { type: "AIRDROP" }>): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: "Only the Phasing side conducts airdrops." };
  const record = activeRecord(state);
  if (!record) return { ok: false, error: "Airdrops need manual opt-in and this Player Turn's start snapshot (AER95/AER96)." };
  if (typeof action.unit !== "string" || !Object.hasOwn(state.units, action.unit) ||
    typeof action.to !== "string" || !Object.hasOwn(ctx.map.hexes, action.to)) return { ok: false, error: "An airdrop names a unit and a target on the map." };
  const done = resolveDrop(ctx, state, record, action.unit, action.to);
  if (!done.ok) return done;
  return { ok: true, state: { ...done.state, airDrop: { ...state.airDrop, record: done.record } },
    events: [{ type: "AIR_DROPPED", side: action.side, unit: action.unit, from: state.units[action.unit]!.at, to: action.to, supplied: done.supplied }] };
}
