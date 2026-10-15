import { hexCard, type HexCard } from "./hexCard";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/** The hex card in the status column (spec 07, part A): the card the model made, as HTML, and the helper that brings it into view after a tap. */

/** The card is shown from the first Player Turn on, not during setup, and only while a hex is being looked at. */
export function cardFor(s: Session): HexCard | null {
  return s.state.phase === "setup" || !s.lookedAt ? null : hexCard(s.ctx, s.state, s.lookedAt);
}

function counterHtml(c: HexCard["counters"][number]): string {
  const held = c.heldBy ? `, ${escape(c.heldBy)}` : "";
  return `<li><span class="hexcard-factors">${escape(c.factors)}</span> <span class="hexcard-kind">${escape(c.kind)}${held}</span> <span class="hexcard-notes">${escape(c.notes.join(", "))}</span></li>`;
}

export function hexCardHtml(s: Session): string {
  const c = cardFor(s);
  if (!c) return "";
  const where = [c.terrain, c.holder].filter(Boolean).join(" ");
  return `<section class="hexcard" aria-labelledby="hexcard-title">
      <div class="hexcard-head"><h2 id="hexcard-title" tabindex="-1">${escape(c.title)}</h2><button id="hexcard-close" type="button" aria-label="Close the hex card">Close</button></div>
      <p class="hexcard-where">${escape(where)}</p>
      <p class="hexcard-count">${escape(c.count)}</p>
      ${c.counters.length ? `<ul class="hexcard-units" aria-label="Counters in ${escape(c.title)}">${c.counters.map(counterHtml).join("")}</ul>` : ""}
    </section>`;
}

/**
 * After a tap: the card's heading takes the keyboard focus (without scrolling) and the card is scrolled just far enough to be seen,
 * never further. A finger's tap is followed by the browser's own mouse events, whose press on the bare map drops the focus to the
 * page again, so the click that ends them gives it back to the heading if nothing else has taken it.
 */
export function revealCard(root: HTMLElement): void {
  const heading = root.querySelector<HTMLElement>("#hexcard-title");
  if (!heading) return;
  const focus = () => heading.focus({ preventScroll: true });
  focus();
  heading.closest<HTMLElement>(".hexcard")!.scrollIntoView({ block: "nearest" });
  const again = () => {
    clearTimeout(stop);
    if (heading.isConnected && (!document.activeElement || document.activeElement === document.body)) focus();
  };
  const stop = setTimeout(() => document.removeEventListener("click", again, true), AFTER_TAP_MS);
  document.addEventListener("click", again, { capture: true, once: true });
}

/** How long after a tap the browser's follow-up mouse events are waited for. */
const AFTER_TAP_MS = 500;
