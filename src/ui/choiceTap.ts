import { legalActions, type Action } from "../engine/actions";
import { turnKey } from "../engine/combat-record";
import { advanceModel, advanceOffers, defaultAdvance } from "./advanceOptions";
import { atStep7h, attacking } from "./attackTap";
import { lossModel, ownPending } from "./lossOptions";
import { run, type Session } from "./session";

/**
 * The choices the engine asks for after a battle (spec 07, State 4): the losses of an Exchange the player settles, and the advance into a hex the
 * defenders left empty. The units picked so far live in `Session.choice`: screen state, never saved. Each confirm is one real action through `run`,
 * hence `applyAction`. The engine has no action that declines an advance: "Stay" only puts the card away (the offer stays until the step ends).
 */

export interface ChoiceDraft {
  /** The Player Turn it was made in (`turnKey`): a draft never outlives it. */
  turn: string;
  /** The Exchange being settled (target and candidates) and the counters picked to lose. */
  losses: { key: string; units: string[] } | null;
  /** The counters picked to advance, by the hex they would enter; absent: the card's starting choice. */
  advance: Record<string, string[]>;
  /** Hexes the player chose to stay out of. */
  stayed: string[];
  /** The cards whose heading has taken the focus already (once each). */
  seen: string[];
}

const fresh = (s: Session): ChoiceDraft => ({ turn: turnKey(s.state), losses: null, advance: {}, stayed: [], seen: [] });

/** The draft for this Player Turn, made if there is none. */
export function draftOf(s: Session): ChoiceDraft {
  if (!s.choice || s.choice.turn !== turnKey(s.state)) s.choice = fresh(s);
  return s.choice;
}

const lossKeyOf = (s: Session): string | null => {
  const p = ownPending(s.state, s.humanSide);
  return p ? `${p.target}:${p.candidates.join(",")}` : null;
};

/** The legal actions for the choices: none unless the player may act now. */
const actionsNow = (s: Session): Action[] => (attacking(s) ? legalActions(s.ctx, s.state) : []);

/** The advance offers the player has not put away: hexes to show a card for. */
export function openOffers(s: Session, actions: readonly Action[]): string[] {
  const stayed = s.choice?.stayed ?? [];
  return advanceOffers(actions).filter((to) => !stayed.includes(to));
}

/** The units picked to lose, or none. */
export function pickedLosses(s: Session): string[] {
  return s.choice?.losses && s.choice.losses.key === lossKeyOf(s) ? s.choice.losses.units : [];
}

/** The units picked to advance into `to`, or the card's starting choice. */
export function pickedAdvance(s: Session, to: string, actions: readonly Action[]): string[] {
  return s.choice?.advance[to] ?? defaultAdvance(s.state, actions, to);
}

/** Keeps the draft honest after any change: gone with its Player Turn or when the player may not act, and without picks that no longer apply. */
export function normaliseChoice(s: Session, actions?: readonly Action[]): void {
  if (!s.choice) return;
  if (!attacking(s) || s.choice.turn !== turnKey(s.state)) { s.choice = null; return; }
  const c = s.choice;
  if (c.losses && c.losses.key !== lossKeyOf(s)) c.losses = null;
  const offers = advanceOffers(actions ?? actionsNow(s));
  for (const to of Object.keys(c.advance)) if (!offers.includes(to)) delete c.advance[to];
}

/** A loss chip: pick the counter to lose, or put it back. */
export function toggleLoss(s: Session, id: string): void {
  const key = lossKeyOf(s);
  const p = ownPending(s.state, s.humanSide);
  if (!key || !p?.candidates.includes(id)) return;
  const have = pickedLosses(s);
  draftOf(s).losses = { key, units: have.includes(id) ? have.filter((u) => u !== id) : [...have, id] };
}

/** A quick pick: choose exactly the units of the n-th way listed on the card. */
export function pickLossWay(s: Session, n: number): void {
  const key = lossKeyOf(s);
  const m = lossModel(s.ctx, s.state, s.humanSide, actionsNow(s), []);
  const way = m?.groups[n];
  if (key && way) draftOf(s).losses = { key, units: [...way.ids] };
}

/** The confirm button of the losses: one ALLOCATE_LOSSES through the engine. */
export function confirmLosses(s: Session): void {
  const p = ownPending(s.state, s.humanSide);
  const m = lossModel(s.ctx, s.state, s.humanSide, actionsNow(s), pickedLosses(s));
  if (!p || !m) return;
  if (m.button.disabled) { s.toast = m.button.text; return; }
  s.toast = "";
  if (run(s, { type: "ALLOCATE_LOSSES", side: p.chooser, units: [...pickedLosses(s)] })) { s.choice = null; showResult(s); }
}

/** An advance chip: add the counter to the advance, or take it out. */
export function toggleAdvance(s: Session, to: string, id: string): void {
  const actions = actionsNow(s);
  const m = advanceModel(s.ctx, s.state, actions, to, null);
  if (!m?.chips.some((c) => c.id === id)) return;
  const have = pickedAdvance(s, to, actions);
  draftOf(s).advance[to] = have.includes(id) ? have.filter((u) => u !== id) : [...have, id];
}

/** The confirm button of an advance: one ADVANCE through the engine. */
export function confirmAdvance(s: Session, to: string): void {
  const actions = actionsNow(s);
  const picked = pickedAdvance(s, to, actions);
  const m = advanceModel(s.ctx, s.state, actions, to, picked);
  if (!m) return;
  if (m.button.disabled) { s.toast = m.button.text; return; }
  s.toast = "";
  if (run(s, { type: "ADVANCE", side: s.state.activeSide, units: [...picked], to })) { delete draftOf(s).advance[to]; showResult(s); }
}

/** "Stay": the units stay where they are. The engine has no action for it, so the card is only put away. */
export function stayOut(s: Session, to: string): void {
  const d = draftOf(s);
  if (!d.stayed.includes(to)) d.stayed = [...d.stayed, to];
  showResult(s);
}

/** The card the player pressed is gone: the result card, which now tells what happened, takes the focus and the scroll (once). */
function showResult(s: Session): void {
  if (s.battle) s.battle.fresh = true;
}

/** The card that needs the keyboard focus now, if its heading has not had it yet (a key such as "losses:M35" or "advance:M35"); marks it as seen. */
export function unseenChoice(s: Session): string | null {
  if (!atStep7h(s)) return null;
  const loss = lossKeyOf(s);
  const first = loss ? undefined : openOffers(s, actionsNow(s))[0];
  const key = loss ? `losses:${loss}` : first ? `advance:${first}` : null;
  if (!key) return null;
  const d = draftOf(s);
  if (d.seen.includes(key)) return null;
  d.seen = [...d.seen, key];
  return key;
}
