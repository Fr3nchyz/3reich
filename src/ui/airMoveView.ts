import { POWER_NAMES } from "../engine/nations";
import { BASES_LIMIT, planeBases, type AirMoveCard, type PlaneLine } from "./airMove";
import { airbaseOwners, airMoveNow, atStep6f, placementsOf } from "./airMoveTap";
import * as T from "./airMoveText";
import { escape } from "./mapGeometry";
import { placeName } from "./names";
import { revealHeading, showTop } from "./reveal";
import type { Session } from "./session";

/**
 * The list "Planes at N bases", the planes card and the airbases of step 6f (spec 09, part D1) as HTML, drawn from the card model. Everything is a button
 * with a stable data-* key or an id, so focusKeep.ts gives the focus back to the same control after each redraw. No rule and no unit id here.
 */

const e = escape;

function lineHtml(l: PlaneLine): string {
  return `<li><button type="button" class="chip pline" data-pline="${e(l.key)}" aria-pressed="${l.state === "ticked"}"><span class="chip-mark">${l.state === "ticked" ? T.MARK_TICKED : T.MARK_FREE}</span><span class="chip-name">${e(l.name)}</span><small>${e(l.note)}</small></button></li>`;
}

function basesHtml(card: AirMoveCard): string {
  if (card.bases.length === 0) return `<p class="move-live">${e(card.why ?? "")}</p>`;
  const shown = card.bases.slice(0, BASES_LIMIT);
  const rows = shown.map((b) => `<li><button type="button" class="plane-row" data-tobase="${e(b.hex)}"><span class="row-name">${e(b.name)}</span><span class="row-count">${e(b.text)}</span></button></li>`).join("");
  const capped = card.bases.length > shown.length ? `<p class="note">${e(T.basesCapped(shown.length, card.bases.length))}</p>` : "";
  return `<h3>${e(T.basesTitle(card.bases.length))}</h3><ul class="stack-rows" aria-label="Bases the ticked planes can go to">${rows}</ul>${capped}<p class="muted">${e(T.BASES_NOTE)}</p>`;
}

function blockedHtml(card: AirMoveCard): string {
  if (card.blocked.length === 0) return "";
  const items = card.blocked.slice(0, BASES_LIMIT).map((b) => `<li><strong>${e(b.name)}:</strong> ${e(b.reason)}</li>`).join("");
  return `<details class="move-where"><summary>${e(T.blockedTitle(card.blocked.length))}</summary><ul class="blocked">${items}</ul></details>`;
}

function reshapeHtml(card: AirMoveCard): string {
  const splits = card.splits.length === 0 ? "" : `<details class="move-where"><summary>${e(T.splitTitle(card.splits[0]!.name, card.splits.length))}</summary><div class="fold-buttons">${card.splits.map((x) => `<button type="button" class="split" data-parts="${x.parts.join(",")}">${e(T.splitButton(x.parts))}</button>`).join("")}</div></details>`;
  const join = card.join ? `<button type="button" id="plane-join">${e(T.joinButton(card.join.total))}</button>` : card.joinWhy ? `<p class="muted">${e(card.joinWhy)}</p>` : "";
  return `${splits}${join}`;
}

function cardHtml(s: Session, card: AirMoveCard): string {
  const ring = s.airMove?.range === true;
  return `<section class="movecard planecard" aria-labelledby="plane-title">
      <div class="card-head"><h2 id="plane-title" tabindex="-1">${e(T.cardTitle(card.title))}</h2><button type="button" id="plane-cancel">Cancel</button></div>
      <p class="muted">${e(card.baseLine)}</p>
      <div class="move-tools"><span class="move-summary" aria-hidden="true">${e(T.tickedCount(card.ticked.length, card.lines.length))}</span><button type="button" id="plane-all">All</button><button type="button" id="plane-none">None</button></div>
      <ul class="chips move-lines" aria-label="Planes at ${e(card.title)}">${card.lines.map(lineHtml).join("")}</ul>
      ${basesHtml(card)}${blockedHtml(card)}${reshapeHtml(card)}
      <button type="button" id="plane-range" aria-pressed="${ring}">${e(ring ? T.HIDE_RANGE : T.SHOW_RANGE)}</button>${ring ? `<p class="muted">${e(T.RANGE_NOTE)}</p>` : ""}
    </section>`;
}

function listHtml(s: Session): string {
  const bases = planeBases(s.ctx, s.state);
  if (bases.length === 0) return "";
  const rows = bases.map((b) => `<li><button type="button" class="plane-row" data-planebase="${e(b.hex)}" aria-pressed="${s.airMove?.hex === b.hex}"><span class="row-name">${e(placeName(s.ctx.map, b.hex))}</span><span class="row-count">${e(T.planesRow(b.planes, b.free))}</span></button></li>`).join("");
  return `<div class="movelist planelist"><h2 id="planes-title">${e(T.planesTitle(bases.length))}</h2><p class="note">${e(T.PLANES_NOTE)}</p><ul class="stack-rows" aria-labelledby="planes-title">${rows}</ul></div>`;
}

/** The airbase part: one row for each Major Power of the side with an airbase left and somewhere to put it; the places when one is being placed. */
function airbasesHtml(s: Session): string {
  const open = s.airbase;
  if (open) {
    const hexes = placementsOf(s, open.owner);
    const power = POWER_NAMES[open.owner];
    const rows = hexes.slice(0, BASES_LIMIT).map((h) => `<li><button type="button" class="plane-row" data-placehex="${e(h)}"><span class="row-name">${e(placeName(s.ctx.map, h))}</span></button></li>`).join("");
    const capped = hexes.length > BASES_LIMIT ? `<p class="note">${e(T.basesCapped(BASES_LIMIT, hexes.length))}</p>` : "";
    return `<section class="movecard airbasecard" aria-labelledby="airbase-title"><div class="card-head"><h2 id="airbase-title" tabindex="-1">${e(T.placeTitle(power))}</h2><button type="button" id="airbase-cancel">Cancel</button></div>
      <p class="move-live">${e(T.placeAdvice(power))}</p>
      <details class="move-where"><summary>${e(T.placeWhere(hexes.length))}</summary><ul class="stack-rows" aria-label="Places for the airbase">${rows}</ul>${capped}</details></section>`;
  }
  const owners = airbaseOwners(s);
  if (owners.length === 0) return "";
  const rows = owners.map((p) => `<li><button type="button" class="plane-row" data-airowner="${p}"><span class="row-name">${e(T.airbaseRow(POWER_NAMES[p], 3 - (s.state.airbasesPlaced?.[p] ?? 0)))}</span></button></li>`).join("");
  return `<div class="movelist airbaselist"><h2 id="airbases-title">${T.AIRBASES_TITLE}</h2><p class="note">${e(T.AIRBASES_NOTE)}</p><ul class="stack-rows" aria-labelledby="airbases-title">${rows}</ul></div>`;
}

/** Planes and airbases at the player's step 6f; empty at any other time. */
export function airMoveHtml(s: Session): string {
  if (!atStep6f(s)) return "";
  const card = airMoveNow(s);
  const body = `${card ? cardHtml(s, card) : listHtml(s)}${airbasesHtml(s)}`;
  return body ? `<section class="air-moves">${card ? listHtml(s) : ""}${body}</section>` : "";
}

/** The sentence a screen reader hears after each change of the open planes card, or none. */
export const airMoveAnnouncement = (s: Session): string => airMoveNow(s)?.announce ?? "";

/** After a base is chosen: the card's heading takes the keyboard focus, once, and the card is brought into view. */
export function revealAirMove(root: HTMLElement, s: Session): void {
  const c = s.airMove;
  const fresh = c?.fresh ? c : s.airbase?.fresh ? s.airbase : null;
  if (!fresh) return;
  fresh.fresh = false;
  const heading = root.querySelector<HTMLElement>(c === fresh ? "#plane-title" : "#airbase-title");
  if (heading) revealHeading(heading, showTop);
}

