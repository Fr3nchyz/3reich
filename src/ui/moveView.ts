import type { Action } from "../engine/actions";
import { hexCard, type CardCounter } from "./hexCard";
import { escape } from "./mapGeometry";
import { LAYER_TITLES, LAYERS, type MoveLine, type MoveSelection } from "./moveSelection";
import { atStep6f, movableStacks, selectionNow } from "./moveTap";
import * as T from "./moveText";
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
  return `<div class="movelist"><p class="note">${e(T.MOVE_PROMPT)}</p>
      <h2 id="stacks-title">Stacks that can move (${stacks.length})</h2>
      <ul class="stack-rows" aria-labelledby="stacks-title">${rows.join("")}</ul></div>`;
}

/** Step 6f for the player: the Move card when a stack is chosen, else the prompt and the list of stacks that can move; nothing at any other time. */
export function moveHtml(s: Session, actions: readonly Action[]): string {
  if (!atStep6f(s) || !actions.some((a) => a.type === "MOVE")) return "";
  const sel = selectionNow(s);
  return `<section class="moves">${sel ? cardHtml(s, sel) : listHtml(s)}</section>`;
}

/** The sentence a screen reader hears after each change of the open card ("2 of 2 ticked. They can go up to 3 hexes."), or none. */
export const moveAnnouncement = (s: Session): string => {
  const sel = selectionNow(s);
  return sel ? `${sel.title}. ${sel.announce}` : "";
};

/** After a stack is chosen: the card's heading takes the keyboard focus, once, and the card is brought into view. */
export function revealMove(root: HTMLElement, s: Session): void {
  const c = s.moveChosen;
  if (!c?.fresh) return;
  c.fresh = false;
  const heading = root.querySelector<HTMLElement>("#move-title");
  if (heading) revealHeading(heading, showTop);
}
