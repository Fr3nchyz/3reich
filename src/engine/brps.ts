import type { GameEvent } from "./action-types";
import type { GameState, Nation, PowerId } from "./types";

/**
 * The BRP ledger (spec 02). A nation's total changes only through these functions, and each
 * change comes back with an event that says why, so the log can explain every BRP.
 */

/** What the nation may still spend this Player Turn: the yearly limit less what is spent, and never more than it has. */
export function spendable(n: Nation): number {
  return Math.max(0, Math.min(n.spendLimit - n.spent, n.brpTotal));
}

export type Ledger = { ok: true; state: GameState; event: GameEvent } | { ok: false; error: string };

const withNation = (state: GameState, id: PowerId, n: Nation): GameState => ({ ...state, nations: { ...state.nations, [id]: n } });

/** Spends BRPs within the Player Turn's limit (Ref 10.0); refuses an overspend with a message naming the limit. */
export function spend(state: GameState, id: PowerId, amount: number, reason: string): Ledger {
  const n = state.nations[id];
  if (!Number.isInteger(amount) || amount < 0) return { ok: false, error: `Cannot spend ${amount} BRPs.` };
  if (amount > n.brpTotal) return { ok: false, error: `${id} has only ${n.brpTotal} BRPs; ${reason} costs ${amount}.` };
  if (amount > spendable(n)) {
    return { ok: false, error: `${reason} costs ${amount} BRPs, but ${id} may spend only ${n.spendLimit} in a Player Turn and has ${n.spent} spent already.` };
  }
  const next = { ...n, brpTotal: n.brpTotal - amount, spent: n.spent + amount };
  return { ok: true, state: withNation(state, id, next), event: { type: "BRPS_CHANGED", nation: id, delta: -amount, total: next.brpTotal, reason } };
}

/**
 * A charge the rules make without the player choosing it (an automatic declaration of war). It
 * does not need the Player Turn's limit and never takes a total below zero.
 * TODO(verify): whether such a charge counts towards the limit.
 */
export function charge(state: GameState, id: PowerId, amount: number, reason: string): { state: GameState; event: GameEvent } {
  const n = state.nations[id];
  const paid = Math.min(amount, n.brpTotal);
  const next = { ...n, brpTotal: n.brpTotal - paid };
  return { state: withNation(state, id, next), event: { type: "BRPS_CHANGED", nation: id, delta: -paid, total: next.brpTotal, reason } };
}

/** A new Player Turn begins: nobody has spent anything yet (Ref 10.0 is a limit per Player Turn). */
export function resetSpending(state: GameState): GameState {
  const nations = Object.fromEntries(Object.entries(state.nations).map(([id, n]) => [id, { ...n, spent: 0 }])) as GameState["nations"];
  return { ...state, nations };
}
