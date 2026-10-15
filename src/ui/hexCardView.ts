import { hexCard, type HexCard } from "./hexCard";
import { whyNotAttack } from "./attackWhy";
import { escape } from "./mapGeometry";
import { revealHeading } from "./reveal";
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
  // The attack card already lists the defenders of the hex it is open on.
  if (!c || s.attack?.target === c.hex) return "";
  const why = whyNotAttack(s, c.hex);
  const where = [c.terrain, c.holder].filter(Boolean).join(" ");
  return `<section class="hexcard" aria-labelledby="hexcard-title">
      <div class="hexcard-head"><h2 id="hexcard-title" tabindex="-1">${escape(c.title)}</h2><button id="hexcard-close" type="button" aria-label="Close the hex card">Close</button></div>
      <p class="hexcard-where">${escape(where)}</p>
      <p class="hexcard-count">${escape(c.count)}</p>
      ${c.counters.length ? `<ul class="hexcard-units" aria-label="Counters in ${escape(c.title)}">${c.counters.map(counterHtml).join("")}</ul>` : ""}
      ${why ? `<p class="hexcard-why">${escape(why)}</p>` : ""}
    </section>`;
}

/** After a tap: the card's heading takes the keyboard focus and the card is scrolled just far enough to be seen, never further (reveal.ts). */
export function revealCard(root: HTMLElement): void {
  const heading = root.querySelector<HTMLElement>("#hexcard-title");
  if (heading) revealHeading(heading, (card) => card.scrollIntoView({ block: "nearest" }));
}
