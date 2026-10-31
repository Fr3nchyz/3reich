import type { GameContext } from "./context";
import { controllingSide } from "./control";
import type { GameState } from "./types";

// spec 14 R8; Ref 32.0, 34.0: each vital area costs Britain 25 BRPs.
export const VITAL_AREA_LOSS = 25;
// spec 14 R8; TODO(verify) V27: carry the deficit into the next Year Start Sequence.
export const V27_DEFICIT_ALLOWED = true;
// spec 14 R8; TODO(verify) V27: both Egyptian cities must be Axis-controlled.
export const V27_SUEZ_NEEDS_BOTH = true;
// spec 14 R8; TODO(verify) V27: retaking a city never refunds its loss; paid flags stay set.
export const V27_NO_RETURN = true;

export interface VitalPaid { gibraltar?: boolean; suez?: boolean }
export interface VitalDue { gibraltar: boolean; suez: boolean; total: number }

/** spec 14 R8, V27: the optional setting exposes the alternative for verification. */
export function suezLost(held: boolean[], needsBoth: boolean = V27_SUEZ_NEEDS_BOTH): boolean {
  return needsBoth ? held.every(Boolean) : held.some(Boolean);
}

/** spec 14 R8, V27: a forced loss may leave a deficit; the alternative drops it. */
export function vitalBalance(total: number, loss: number, deficitAllowed: boolean = V27_DEFICIT_ALLOWED): number {
  return deficitAllowed ? total - loss : Math.max(0, total - loss);
}

// spec 14 R8: use map city names, and the controller's current side, for both areas.
const axisHoldsCity = (ctx: GameContext, state: GameState) => (name: string): boolean => {
  const hex = Object.values(ctx.map.hexes).find((h) => h.name === name);
  if (!hex) throw new Error(`Missing vital area city: ${name}`);
  return controllingSide(ctx, state, hex.id) === "axis";
};

/** What Britain owes now, given what was already paid. Pure. */
export function vitalAreasDue(ctx: GameContext, state: GameState, paid: VitalPaid): VitalDue {
  const axisHolds = axisHoldsCity(ctx, state);
  // spec 14 R8: separate, once-only losses; neither is refunded on recapture (V27_NO_RETURN).
  const gibraltar = !paid.gibraltar && axisHolds("Gibraltar");
  const suez = !paid.suez && suezLost([axisHolds("Suez"), axisHolds("Alexandria")]);
  return { gibraltar, suez, total: (Number(gibraltar) + Number(suez)) * VITAL_AREA_LOSS };
}

/** New state with Britain's losses removed (negative allowed, V27), and new paid flags. */
export function payVitalAreas(ctx: GameContext, state: GameState, paid: VitalPaid, noReturn: boolean = V27_NO_RETURN): { state: GameState; paid: VitalPaid; due: VitalDue } {
  const due = vitalAreasDue(ctx, state, paid);
  // spec 14 R8: brps.ts charges clamp at zero; copy Britain to preserve the V27 deficit without spending.
  const britain = state.nations.britain;
  const next = { ...state, nations: { ...state.nations, britain: { ...britain, brpTotal: vitalBalance(britain.brpTotal, due.total) } } };
  // spec 14 R8: retain previously paid flags even after the cities are retaken (V27_NO_RETURN).
  const merged: VitalPaid = { ...paid, ...(due.gibraltar ? { gibraltar: true } : {}), ...(due.suez ? { suez: true } : {}) };
  if (noReturn) return { state: next, paid: merged, due };
  // The alternative: a city retaken by the Allies clears its flag, so a later Axis capture costs again.
  const holds = axisHoldsCity(ctx, state);
  const kept: VitalPaid = {
    ...(merged.gibraltar && holds("Gibraltar") ? { gibraltar: true } : {}),
    ...(merged.suez && suezLost([holds("Suez"), holds("Alexandria")]) ? { suez: true } : {}),
  };
  return { state: next, paid: kept, due };
}
