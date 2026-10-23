import type { Action } from "../engine/actions";
import { escape } from "./mapGeometry";
import { placeName } from "./names";
import { confirmFor, moverStacks, panelOf } from "./redeployModel";
import { selectionNow } from "./redeployTap";
import * as T from "./redeployText";
import { lastLine, takeBackReason } from "./redeployUndo";
import { revealHeading, showTop } from "./reveal";
import type { Session } from "./session";
import { atStep9e } from "./step9e";

/**
 * The Redeploy panel of step 9e (spec 16 D4, ticket 16-19) as HTML: the allowance of each nation, the list of stacks that can be redeployed (and, folded
 * away, the units that cannot, with the reason), the card of the chosen stack with its unit chips, the list "Where they can go" and the confirm card.
 * Every control is a button with a stable data-* key or an id (focusKeep.ts gives the focus back after a redraw) and is at least 44 px. The words come from
 * redeployText.ts, the numbers from redeployModel.ts; no rule and no unit id here.
 * TODO(16-20): a "Send toward the front" button belongs on the confirm card (D4): it is the computer's own choice of hex for the ticked units (Part E,
 * src/ai/redeploy.ts). That policy is ticket 16-20 and is not merged, so the button is left out until it is; this screen must not invent a policy.
 */

const e = escape;
const MARKS = { ticked: "Ticked", free: "Not ticked", greyed: "Cannot go" } as const;

/** The most places the fold-out lists (the nearest first); the map shows the rest. */
export const WHERE_LIMIT = 40;
/** The most units the folded list of units that cannot go names. */
const CANNOT_LIMIT = 60;

const allowanceHtml = (s: Session): string => `<p class="sr-allow">${panelOf(s.ctx, s.state).allowances.map((a) => e(T.allowanceLine(a.power, a.left, a.of))).join(" ")}</p>`;

/** "Take back last redeployment": a 44 px button always there at the player's step 9e, grey with the reason in words when there is nothing to take back. */
function undoHtml(s: Session): string {
  const why = takeBackReason(s);
  const note = why ?? `Last redeployment: ${lastLine(s)}`;
  return `<div class="moveundo"><button type="button" id="sr-undo" class="undo" aria-describedby="sr-undo-why"${why ? ' aria-disabled="true"' : ""}>${T.UNDO_BUTTON}</button><span id="sr-undo-why" class="undo-why">${e(note)}</span></div>`;
}

/** The units that cannot be redeployed, each with the reason, folded away. */
function cannotHtml(s: Session): string {
  const rows = panelOf(s.ctx, s.state).stacks.flatMap((k) => k.lines.filter((l) => !l.can).map((l) => ({ k, l })));
  if (rows.length === 0) return "";
  const items = rows.slice(0, CANNOT_LIMIT).map(({ k, l }) => `<li><strong>${e(k.title)}</strong>: ${e(l.name)}, ${e(l.note ?? T.REASON_OTHER)}</li>`).join("");
  const more = rows.length > CANNOT_LIMIT ? `<li>and ${rows.length - CANNOT_LIMIT} more</li>` : "";
  return `<details class="sr-cannot"><summary>${e(T.cannotSummary(rows.length))}</summary><ul>${items}${more}</ul></details>`;
}

/** "Stacks that can be redeployed": one 44 px row per hex, the way in when a finger cannot hit a small hex on the map. */
function listHtml(s: Session): string {
  const rows = moverStacks(s.ctx, s.state).map((k) => `<li><button type="button" class="sr-row" data-srstack="${e(k.hex)}"><span class="row-name">${e(k.title)}</span><span class="row-count">${e(T.canMove(k.movers))}</span></button></li>`);
  return `<div class="movelist srlist"><h2 id="sr-title">${T.PANEL_TITLE}</h2>${allowanceHtml(s)}
      <p class="note">${e(T.PROMPT)}</p>
      <ul class="stack-rows" aria-label="Stacks that can be redeployed">${rows.join("")}</ul>${cannotHtml(s)}</div>`;
}

function whereHtml(s: Session, destinations: readonly string[]): string {
  if (destinations.length === 0) return "";
  const shown = destinations.slice(0, WHERE_LIMIT);
  const items = shown.map((d) => `<li><button type="button" class="sr-dest" data-srdest="${e(d)}"><span class="row-name">${e(placeName(s.ctx.map, d))}</span></button></li>`).join("");
  const capped = destinations.length > shown.length ? `<p class="note">${e(T.whereCapped(shown.length, destinations.length))}</p>` : "";
  return `<details class="move-where" id="sr-where"${s.redeploy?.whereOpen ? " open" : ""}><summary id="sr-where-sum">${e(T.whereSummary(destinations.length))}</summary><ul class="stack-rows" aria-label="Places the ticked units can go">${items}</ul>${capped}</details>`;
}

/** The confirm card: what will happen, what the nation will have left, and the buttons. */
function confirmHtml(s: Session, ids: readonly string[], to: string): string {
  const said = confirmFor(s.ctx, s.state, ids, to);
  return `<div class="srconfirm" role="group" aria-labelledby="sr-confirm-q"><p id="sr-confirm-q" class="sr-question">${e(said.question)}</p><p class="sr-left">${e(said.left)}</p>
      <div class="actions controls"><button type="button" id="sr-confirm">${T.CONFIRM_BUTTON}</button><button type="button" id="sr-change">${T.CHANGE_BUTTON}</button></div></div>`;
}

/** The card of the chosen stack. */
function cardHtml(s: Session): string {
  const sel = selectionNow(s)!;
  const lines = sel.lines
    .map((l) => {
      const state = !l.can ? "greyed" : l.ticked ? "ticked" : "free";
      const note = l.note ? `<small>${e(l.note)}</small>` : "";
      return `<li><button type="button" class="chip sr-line${l.can ? "" : " greyed"}" data-srunit="${e(l.id)}"${l.can ? ` aria-pressed="${l.ticked}"` : ' aria-disabled="true"'}><span class="chip-mark">${MARKS[state]}</span><span class="chip-name">${e(l.name)}</span>${note}</button></li>`;
    })
    .join("");
  const to = s.redeploy?.to;
  const live = to ? "" : `<p class="move-live">${e(sel.why ?? (sel.ticked.length === 0 ? T.NOTHING_TICKED : "Tap a yellow hex to redeploy them there."))}</p>`;
  return `<section class="movecard srcard" aria-labelledby="sr-card-title">
      <div class="card-head"><h2 id="sr-card-title" tabindex="-1">Redeploy from ${e(sel.title)}</h2><button type="button" id="sr-cancel">${T.CANCEL_BUTTON}</button></div>
      ${allowanceHtml(s)}
      <div class="move-tools"><span class="move-summary" aria-hidden="true">${e(sel.summary)}</span><button type="button" id="sr-all">All</button><button type="button" id="sr-none">None</button></div>
      <ul class="chips move-lines" aria-label="Counters in ${e(sel.title)}">${lines}</ul>
      ${live}${to ? confirmHtml(s, sel.ticked, to) : ""}${whereHtml(s, sel.destinations)}
    </section>`;
}

/** Step 9e for the player: the take-back button, then the card of the chosen stack, else the allowances and the list of stacks. Nothing at any other time. */
export function redeployHtml(s: Session, _actions: readonly Action[]): string {
  if (!atStep9e(s)) return "";
  return `<section class="moves srpanel">${undoHtml(s)}${selectionNow(s) ? cardHtml(s) : listHtml(s)}</section>`;
}

/** The sentence a screen reader hears after each change of the open card, or none. */
export const redeployAnnouncement = (s: Session): string => {
  const sel = selectionNow(s);
  if (sel) return `${sel.title}. ${sel.summary}${s.redeploy?.to ? ` ${confirmFor(s.ctx, s.state, sel.ticked, s.redeploy.to).question}` : ` ${sel.destinations.length} places to go.`}`;
  return s.toast.startsWith(T.TOOK_BACK_PREFIX) ? s.toast : "";
};

/** After a stack is chosen: the card's heading takes the keyboard focus, once, and the card is brought into view. */
export function revealRedeploy(root: HTMLElement, s: Session): void {
  const c = s.redeploy;
  if (!c?.fresh) return;
  c.fresh = false;
  const heading = root.querySelector<HTMLElement>("#sr-card-title");
  if (heading) revealHeading(heading, showTop);
}
