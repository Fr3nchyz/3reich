import type { Action } from "../engine/actions";
import { hexCard, type CardCounter } from "./hexCard";
import { escape } from "./mapGeometry";
import { LAYER_TITLES, LAYERS, type MoveLine, type MoveSelection } from "./moveSelection";
import { movableStacks, selectionNow } from "./moveTap";
import * as T from "./moveText";
import { lastMoveLine, takeBackReason, takeBackShown } from "./moveUndo";
import { placeName } from "./names";
import { revealHeading, showTop } from "./reveal";
import type { Session } from "./session";

/**
 * The Move card and the list "Stacks that can move" of step 6f (spec 10, ticket 10-4) as HTML, drawn from the selection model. Everything is a button
 * with a stable data-* key (data-stack, data-unit) or an id, so focusKeep.ts gives the focus back to the same control after each redraw. No rule
 * and no unit id here: the words come from moveText.ts, the lines from the counters of the hex card.
 */

const e = escape;
const MARKS = { ticked: T.MARK_TICKED, free: T.MARK_FREE, greyed: T.MARK_GREYED } as const;

/** One unit line: the counter as the hex card names it, a tick mark in words, and the note ("stays here" or why it cannot move). */
function lineHtml(l: MoveLine, c: CardCounter | undefined): string {
  const grey = l.state === "greyed";
  const name = c ? `<span class="hexcard-factors">${e(c.factors)}</span> ${e(c.kind)}${c.heldBy ? `, ${e(c.heldBy)}` : ""}` : e(l.name);
  const note = l.note ? `<small>${e(l.note)}</small>` : "";
  return `<li><button type="button" class="chip mline${grey ? " greyed" : ""}" data-unit="${e(l.key)}"${grey ? ' aria-disabled="true"' : ` aria-pressed="${l.state === "ticked"}"`}><span class="chip-mark">${MARKS[l.state]}</span><span class="chip-name">${name}</span>${note}</button></li>`;
}

/** The lines, the ground ones first; a heading over each layer only when the hex holds more than one (decision 2: air and naval lines are separate). */
function linesHtml(s: Session, sel: MoveSelection): string {
  const counters = new Map(hexCard(s.ctx, s.state, sel.hex).counters.map((c) => [c.key, c]));
  const layers = LAYERS.filter((k) => sel.lines.some((l) => l.layer === k));
  return layers
    .map((k) => {
      const items = sel.lines.filter((l) => l.layer === k).map((l) => lineHtml(l, counters.get(l.key))).join("");
      return `${layers.length > 1 ? `<h3>${LAYER_TITLES[k]}</h3>` : ""}<ul class="chips move-lines" aria-label="${LAYER_TITLES[k]} counters in ${e(sel.title)}">${items}</ul>`;
    })
    .join("");
}

/** The live line: where the ticked units can go together, what a faster one could do alone, and the next thing to do. */
function liveHtml(sel: MoveSelection): string {
  const parts = [sel.together, sel.further, sel.room, sel.advice, sel.leftBehind].filter((x): x is string => !!x);
  return parts.map((p) => `<p class="move-live">${e(p)}</p>`).join("");
}

/** The Move card: the chosen hex, All / None / Cancel, the unit lines and the live line. */
function cardHtml(s: Session, sel: MoveSelection): string {
  const tools = sel.status === "nobody" ? "" : `<div class="move-tools"><span class="move-summary" aria-hidden="true">${e(sel.summary)}</span><button type="button" id="move-all">All</button><button type="button" id="move-none">None</button></div>`;
  return `<section class="movecard" aria-labelledby="move-title">
      <div class="card-head"><h2 id="move-title" tabindex="-1">Move from ${e(sel.title)}</h2><button type="button" id="move-cancel">Cancel</button></div>
      ${tools}${linesHtml(s, sel)}${liveHtml(sel)}
    </section>`;
}

/** "Stacks that can move (14)": one 44 px row per hex, the way in when a finger cannot hit a small hex on the map. */
function listHtml(s: Session): string {
  const stacks = movableStacks(s);
  const rows = stacks.map((k) => `<li><button type="button" class="stack-row" data-stack="${e(k.hex)}"><span class="row-name">${e(placeName(s.ctx.map, k.hex))}</span><span class="row-count">${e(T.canMove(k.units))}</span></button></li>`);
  return `<div class="movelist"><h2 id="stacks-title">Stacks that can move (${stacks.length})</h2>
      <p class="note">${e(T.MOVE_PROMPT)}</p>
      <ul class="stack-rows" aria-labelledby="stacks-title">${rows.join("")}</ul></div>`;
}

/**
 * "Take back last move" (spec 10, 10-6): a 44 px button that is always there at the player's step 6f, grey with the reason in words when there is
 * nothing to take back (aria-disabled, so it keeps the keyboard focus), and with the move it would undo in words when there is.
 */
function undoHtml(s: Session): string {
  const why = takeBackReason(s);
  const note = why ?? `Last move: ${lastMoveLine(s)}`;
  return `<div class="moveundo"><button type="button" id="move-undo" class="undo" aria-describedby="move-undo-why"${why ? ' aria-disabled="true"' : ""}>${T.UNDO_BUTTON}</button><span id="move-undo-why" class="undo-why">${e(note)}</span></div>`;
}

/**
 * Step 6f for the player: the take-back button, then the Move card when a stack is chosen, else the prompt and the list of stacks that can move;
 * nothing at any other time (and, with no unit able to move and no move to take back, nothing at all).
 */
export function moveHtml(s: Session, actions: readonly Action[]): string {
  if (!takeBackShown(s)) return "";
  const moves = actions.some((a) => a.type === "MOVE");
  if (!moves && !lastMoveLine(s)) return "";
  const sel = selectionNow(s);
  return `<section class="moves">${undoHtml(s)}${!moves ? "" : sel ? cardHtml(s, sel) : listHtml(s)}</section>`;
}

/** The sentence a screen reader hears after each change of the open card ("2 of 2 ticked. They can go up to 3 hexes."), or none. */
export const moveAnnouncement = (s: Session): string => {
  const sel = selectionNow(s);
  if (sel) return `${sel.title}. ${sel.announce}`;
  return s.toast.startsWith(T.TOOK_BACK_PREFIX) ? s.toast : ""; // a take back drops the card: the screen reader still hears what was undone
};

/** After a stack is chosen: the card's heading takes the keyboard focus, once, and the card is brought into view. */
export function revealMove(root: HTMLElement, s: Session): void {
  const c = s.moveChosen;
  if (!c?.fresh) return;
  c.fresh = false;
  const heading = root.querySelector<HTMLElement>("#move-title");
  if (heading) revealHeading(heading, showBelowBar);
}

/** The card replaces the list under the bar, so after a scroll its top can sit behind the sticky bar: bring it just under the bar then (else as any card, showTop). */
function showBelowBar(card: HTMLElement): void {
  showTop(card);
  const bar = document.querySelector(".nextbar");
  if (bar && card.getBoundingClientRect().top < bar.getBoundingClientRect().bottom) card.scrollIntoView({ block: "start" });
}

/**
 * When step 6f begins for the player: the status column goes back to its top, so the turn line, the Next bar and the list "Stacks that can move"
 * are in view together (the page stays where the last press left it otherwise). A short screen: the bar and the list matter more than the turn line.
 */
export function revealMoveStep(root: HTMLElement): void {
  const top = root.querySelector(".turn");
  if (!(top instanceof HTMLElement)) return;
  top.scrollIntoView({ block: "start" });
  const list = root.querySelector("#stacks-title");
  const bar = root.querySelector(".nextbar");
  if (list instanceof HTMLElement && bar instanceof HTMLElement && list.getBoundingClientRect().bottom + 56 > window.innerHeight) bar.scrollIntoView({ block: "start" });
}
