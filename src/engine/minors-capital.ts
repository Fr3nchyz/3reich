import type { GameEvent } from "./action-types";
import { capitalOf } from "./minors-rules";
import { conquestRecipient } from "./conquest-income";
import type { GameContext } from "./context";
import { controllerOf, sideInWar } from "./control";
import type { GameState, GameTurn, MinorCountry, PowerId } from "./types";
import { sideOfPower } from "./war";

// Spec 15 R13 / Ref 16.0; TODO(verify) MC20: observe loss, answer by the owner's next 7p.
export const MC20_ANSWER_AT_COMBAT_END = true;
// Spec 15 R13 / Ref 16.0; TODO(verify) MC20: no debt; move only the BRPs actually deducted.
export const MC20_CAP_TRANSFER_AT_AVAILABLE = true;

/** R13: caller-owned records, including activation payments; never inferred from a table or current balance. */
export interface CapitalBrpsRecord {
  paid?: { year: number; amount: number };
  loss?: { at: GameTurn; answer: GameTurn; owner: PowerId };
  settled?: true;
}
export type CapitalAnswerWindow = {
  status: "ineligible" | "safe" | "waiting" | "due" | "settled";
  record: CapitalBrpsRecord;
};
const seasons = ["spring", "summer", "fall", "winter"] as const;
const ordinal = (at: GameTurn) => at.year * 4 + seasons.indexOf(at.season);
const nextTurn = (at: GameTurn): GameTurn => {
  const index = seasons.indexOf(at.season) + 1;
  return { year: at.year + Math.floor(index / 4), season: seasons[index % 4]! };
};

/** Spec 15 R13 / Ref 16.0: only an active ally with an opposing capital controller starts a loss. */
export function capitalLostProblem(ctx: GameContext, state: GameState, country: MinorCountry): string | null {
  const ally = state.minorAllies.find((m) => m.owner === country && m.active);
  if (!ally || sideOfPower(state.nations[ally.of]) === null) return "No active Minor-Ally owner.";
  const capital = capitalOf(ctx, country);
  const holder = capital === null ? null : controllerOf(ctx, state, capital);
  const protector = state.minorAllies.find((m) => m.owner === holder && m.active);
  const side = holder === null ? null : protector ? sideOfPower(state.nations[protector.of]) : sideInWar(state, holder);
  if (side === null || side === sideOfPower(state.nations[ally.of])) return "Capital is not held by the opposing side.";
  return null;
}

/** R13 / MC20: call on loss and at settlement; persist returned records, including cleared recaptures. */
export function capitalAnswerWindow(ctx: GameContext, state: GameState, country: MinorCountry, record: CapitalBrpsRecord = {}): CapitalAnswerWindow {
  const ally = state.minorAllies.find((m) => m.owner === country && m.active);
  if (!ally) return { status: "ineligible", record };
  if (record.settled) return { status: "settled", record };
  if (capitalLostProblem(ctx, state, country) !== null) {
    const capital = capitalOf(ctx, country);
    const holder = capital === null ? null : controllerOf(ctx, state, capital);
    const protector = state.minorAllies.find((m) => m.owner === holder && m.active);
    const side = holder === null ? null : protector ? sideOfPower(state.nations[protector.of]) : sideInWar(state, holder);
    // R13 / MC20: only friendly control answers; an uncontrolled capital preserves the clock.
    if (side === null) return { status: record.loss ? "waiting" : "safe", record };
    const { loss: _loss, ...cleared } = record;
    void _loss;
    return { status: "safe", record: cleared };
  }
  const ownerSide = sideOfPower(state.nations[ally.of]);
  const at = { year: state.year, season: state.season };
  // R13 / MC20: same Game Turn if the owner's Player Turn is still to come, otherwise next Game Turn.
  const loss = record.loss ?? { at, owner: ally.of, answer: state.activeSide !== ownerSide && state.activeSide === state.firstSide ? at : nextTurn(at) };
  const due = loss.owner === ally.of && state.activeSide === ownerSide &&
    ordinal(at) >= ordinal(loss.answer) && state.position?.part === "player-turn" &&
    (!MC20_ANSWER_AT_COMBAT_END || state.position.step === "7p");
  return { status: due ? "due" : "waiting", record: { ...record, loss } };
}

/** R13 / Ref 16.0: explicit current-year payment only; immutable, once per persisted loss record. */
export function applyCapitalBrpsMove(ctx: GameContext, state: GameState, country: MinorCountry, record: CapitalBrpsRecord = {}): { state: GameState; events: GameEvent[]; record: CapitalBrpsRecord } {
  const window = capitalAnswerWindow(ctx, state, country, record);
  if (window.status !== "due") return { state, events: [], record: window.record };
  const done: CapitalBrpsRecord = { ...window.record, settled: true };
  const paid = record.paid;
  if (!paid || paid.year !== state.year || !Number.isInteger(paid.amount) || paid.amount <= 0) return { state, events: [], record: done };
  const from = window.record.loss!.owner;
  const holder = controllerOf(ctx, state, capitalOf(ctx, country)!)!;
  const to = conquestRecipient(state, holder);
  const amount = MC20_CAP_TRANSFER_AT_AVAILABLE ? Math.min(paid.amount, state.nations[from].brpTotal) : paid.amount;
  const nations = { ...state.nations, [from]: { ...state.nations[from], brpTotal: state.nations[from].brpTotal - amount }, [to]: { ...state.nations[to], brpTotal: state.nations[to].brpTotal + amount } };
  const reason = `Lost ${country} capital (spec 15 R13; Ref 16.0)`;
  const events: GameEvent[] = [
    { type: "BRPS_CHANGED", nation: from, delta: -amount, total: nations[from].brpTotal, reason },
    { type: "BRPS_CHANGED", nation: to, delta: amount, total: nations[to].brpTotal, reason },
  ];
  return { state: { ...state, nations }, events, record: done };
}
