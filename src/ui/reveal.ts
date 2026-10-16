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

/** The edge of the area the status column scrolls in, below: the bottom of the column when it scrolls on its own, else the bottom of the window. */
function bottomEdge(card: HTMLElement): number {
  const column = card.closest<HTMLElement>("#status");
  if (column && column.scrollHeight > column.clientHeight + 1 && getComputedStyle(column).overflowY !== "visible") return column.getBoundingClientRect().bottom;
  return window.innerHeight;
}

/**
 * Scrolls a choice card (losses, advance) to the top of the area as soon as it does not fit in it, so its options are not left under its own
 * button bar; a card that fits where it is stays put. The card is what the game waits for, so it gets the room.
 */
export function showChoice(card: HTMLElement): void {
  const r = card.getBoundingClientRect();
  if (r.top < topEdge(card) || r.bottom > bottomEdge(card)) card.scrollIntoView({ block: "start" });
}

/** The height the first row of "Attacks you can make" needs to count as shown. */
const ROW_PEEK = 56;

/**
 * When step 7h begins for the player: the column goes back to its top, so the turn line, the "Next:" bar and the list "Attacks you can make"
 * are in view together. Nothing moves if the list's heading and the start of its first row are already on screen.
 */
export function revealStep(root: HTMLElement): void {
  const top = root.querySelector(".turn");
  const list = root.querySelector("#attacks-title");
  if (!(top instanceof HTMLElement)) return;
  const shown = () => list instanceof HTMLElement && list.getBoundingClientRect().top >= topEdge(top) && list.getBoundingClientRect().bottom + ROW_PEEK <= bottomEdge(top);
  if (shown()) return;
  top.scrollIntoView({ block: "start" });
  // A short screen (a phone on its side): the turn line can go, the bar and the list matter more.
  const bar = root.querySelector(".nextbar");
  if (!shown() && bar instanceof HTMLElement) bar.scrollIntoView({ block: "start" });
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

/**
 * A card opened by a press: the choice the engine asks for (`choice`, a key from `unseenChoice`, once), the attack card, or the result of the
 * battle (each once, when it is new). A choice takes the focus before the result, which is only text.
 */
export function revealFresh(root: HTMLElement, s: { attack?: { fresh: boolean } | null; battle?: { fresh: boolean } | null }, choice: string | null = null): void {
  if (choice && s.battle) s.battle.fresh = false;
  const which = choice ? "choice" : s.attack?.fresh ? "attack" : s.battle?.fresh ? "result" : null;
  if (!which) return;
  if (which === "attack") s.attack!.fresh = false;
  else if (which === "result") s.battle!.fresh = false;
  const heading = root.querySelector<HTMLElement>(which === "choice" ? "#choice-title-0" : `#${which}-title`);
  if (heading) revealHeading(heading, which === "choice" ? showChoice : showTop);
}
