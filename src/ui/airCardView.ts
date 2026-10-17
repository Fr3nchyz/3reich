import type { Action } from "../engine/actions";
import { MISSION_RANGE } from "../engine/air-rules";
import { airPick, type AirChip, type AirPick } from "./airPick";
import { airTargets } from "./airTap";
import * as T from "./airText";
import { atStep7b } from "./airView";
import { escape } from "./mapGeometry";
import { placeName } from "./names";
import { revealHeading, showTop } from "./reveal";
import type { Session } from "./session";

/**
 * The list "Air support you can add" and the air card of step 7b (spec 09, part D2) as HTML, drawn from the pick model. Everything is a button with a
 * stable data-* key (data-airtarget, data-plane) or an id, so focusKeep.ts gives the focus back to the same control after each redraw. No rule here.
 */

const e = escape;
const MARKS = { chosen: T.MARK_CHOSEN, free: T.MARK_FREE, committed: T.MARK_COMMITTED, greyed: T.MARK_GREYED } as const;

/** One 44 px row per hex planes can be committed to, the way in when a finger cannot hit a small hex on the map. */
function listHtml(s: Session, targets: readonly string[]): string {
  const rows = targets.map((t) => {
    const p = airPick(s.ctx, s.state, t, [])!;
    const committed = p.committed > 0 ? ` ${T.rowCommitted(p.committed)}.` : "";
    return `<li><button type="button" class="air-row" data-airtarget="${e(t)}" aria-pressed="${s.airDraft?.target === t}"><span class="row-name">${e(placeName(s.ctx.map, t))}</span><span class="row-defence">${e(T.rowReach(p.available.planes, p.available.factors, p.cap))}.${e(committed)}</span></button></li>`;
  });
  return `<div class="attacklist airlist"><h2 id="air-list-title">${T.listTitle(targets.length)}</h2>
      <p class="note">${e(T.LIST_NOTE)}</p>
      <ul class="attack-rows" aria-labelledby="air-list-title">${rows.join("")}</ul></div>`;
}

function chipHtml(c: AirChip): string {
  const grey = c.state === "greyed";
  const fixed = c.state === "committed";
  const note = `${c.from}, ${c.distance}${grey ? `. It ${c.reason}` : ""}`;
  const attrs = fixed ? ' aria-disabled="true" aria-pressed="true"' : grey ? ' aria-disabled="true"' : ` aria-pressed="${c.state === "chosen"}"`;
  return `<li><button type="button" class="chip${grey || fixed ? " greyed" : ""}" data-plane="${e(c.id)}"${attrs}><span class="chip-mark" aria-hidden="true">${MARKS[c.state]}</span><span class="chip-name">${e(c.name)}</span><small>${e(note)}</small></button></li>`;
}

function cardHtml(p: AirPick): string {
  return `<section class="attackcard aircard" aria-labelledby="air-title">
      <div class="card-head"><h2 id="air-title" tabindex="-1">${e(T.cardTitle(p.targetName))}</h2><button type="button" id="air-cancel">${T.CANCEL}</button></div>
      <h3 id="air-with">${T.cardPlanes(MISSION_RANGE)} <small>(${T.CARD_HINT})</small></h3>
      <ul class="chips attack-chips" aria-labelledby="air-with">${p.chips.map(chipHtml).join("")}</ul>
      <p class="odds">${e(T.cardTotals(p.chosen, p.committed, p.cap))}</p>
      <p class="warn">${e(T.MUST_ATTACK)}</p>
      <div class="attack-foot"><button type="button" id="air-go" class="attack-go"${p.button.disabled ? " disabled" : ""}>${e(p.button.text)}</button></div>
    </section>`;
}

/** The air list, and the card under it when a hex is open; empty unless it is the player's step 7b and planes can be committed. */
export function airHtml(s: Session, actions: readonly Action[]): string {
  if (!atStep7b(s)) return "";
  const targets = airTargets(actions);
  if (targets.length === 0) return "";
  const d = s.airDraft;
  const pick = d ? airPick(s.ctx, s.state, d.target, d.units) : null;
  return `<section class="attacks air-support">${listHtml(s, targets)}${pick ? cardHtml(pick) : ""}</section>`;
}

/** After a hex is opened: the card's heading takes the keyboard focus, once, and the card is brought into view. */
export function revealAir(root: HTMLElement, s: Session): void {
  const d = s.airDraft;
  if (!d?.fresh) return;
  d.fresh = false;
  const heading = root.querySelector<HTMLElement>("#air-title");
  if (heading) revealHeading(heading, showTop);
}

/** The sentence a screen reader hears after each change of the open air card ("Poznan (M33). Air chosen: 5 air factors..."), or none. */
export function airAnnouncement(s: Session): string {
  const d = s.airDraft;
  const p = d && atStep7b(s) ? airPick(s.ctx, s.state, d.target, d.units) : null;
  return p ? `${p.targetName}. ${T.cardTotals(p.chosen, p.committed, p.cap)}` : "";
}
