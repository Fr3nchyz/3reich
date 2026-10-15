/**
 * After a card opens: its heading takes the keyboard focus (without scrolling) and the card is brought into view. A finger's tap is followed by
 * the browser's own mouse events, whose press on the bare map drops the focus to the page again, so the click that ends them gives it back to
 * the heading if nothing else has taken it.
 */

/** How long after a tap the browser's follow-up mouse events are waited for. */
const AFTER_TAP_MS = 500;

/** The edge of the area the status column scrolls in: the status column itself when it scrolls on its own (two columns), else the pinned map's bottom. */
function topEdge(card: HTMLElement): number {
  const column = card.closest<HTMLElement>("#status");
  if (column && column.scrollHeight > column.clientHeight + 1 && getComputedStyle(column).overflowY !== "visible") return column.getBoundingClientRect().top;
  return document.querySelector(".map-dock")?.getBoundingClientRect().bottom ?? 0;
}

/**
 * Scrolls so the top of the card is in the upper half of the area it scrolls in, only as far as needed and never the other way: nothing happens
 * when its top is already there (a card whose heading only peeks in at the bottom is not "in view": its button bar would cover the rest).
 */
export function showTop(card: HTMLElement): void {
  const edge = topEdge(card);
  const top = card.getBoundingClientRect().top;
  if (top < edge || top > edge + (window.innerHeight - edge) / 2) card.scrollIntoView({ block: "start" });
}

/** When step 7h begins for the player: the step buttons come to the top of the panel with "Attacks you can make" under them (nothing moves if they are already there). */
export function revealStep(root: HTMLElement): void {
  const buttons = root.querySelector(".attacks")?.previousElementSibling;
  if (buttons instanceof HTMLElement) showTop(buttons);
}

/** Focuses `heading` and brings its card into view with `show`. */
export function revealHeading(heading: HTMLElement, show: (card: HTMLElement) => void): void {
  const focus = () => heading.focus({ preventScroll: true });
  focus();
  show(heading.parentElement!.parentElement!);
  const again = () => {
    clearTimeout(stop);
    if (heading.isConnected && (!document.activeElement || document.activeElement === document.body)) focus();
  };
  const stop = setTimeout(() => document.removeEventListener("click", again, true), AFTER_TAP_MS);
  document.addEventListener("click", again, { capture: true, once: true });
}

/** A card opened by a press: the attack card, or the result of the battle (each once, when it is new). */
export function revealFresh(root: HTMLElement, s: { attack?: { fresh: boolean } | null; battle?: { fresh: boolean } | null }): void {
  const which = s.attack?.fresh ? "attack" : s.battle?.fresh ? "result" : null;
  if (!which) return;
  (which === "attack" ? s.attack! : s.battle!).fresh = false;
  const heading = root.querySelector<HTMLElement>(`#${which}-title`);
  if (heading) revealHeading(heading, showTop);
}
