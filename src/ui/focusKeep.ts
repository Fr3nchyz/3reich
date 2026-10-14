/**
 * The status area is redrawn from scratch after every change, which drops the keyboard focus to the page.
 * These two functions note which control inside it had focus and give it back to its twin in the new HTML.
 * Nothing is done when the focus was somewhere else, so a redraw never steals it.
 */

export interface FocusMark {
  /** A selector that finds the control and its kind of siblings. */
  selector: string;
  /** Its place among the matches, and its label, to tell it from them. */
  index: number;
  text: string;
}

/** The first of a control's own identifying attributes: an id, a data-* value, or else its tag and class. */
function selectorOf(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const first = Object.entries(el.dataset)[0];
  if (first) {
    const name = first[0].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    return `${el.tagName.toLowerCase()}[data-${name}="${(first[1] ?? "").replace(/["\\]/g, "\\$&")}"]`;
  }
  return el.classList.length ? `${el.tagName.toLowerCase()}.${CSS.escape(el.classList[0]!)}` : el.tagName.toLowerCase();
}

export function captureFocus(root: HTMLElement): FocusMark | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === root || !root.contains(el)) return null;
  const selector = selectorOf(el);
  return { selector, index: Array.from(root.querySelectorAll(selector)).indexOf(el), text: el.textContent ?? "" };
}

/** Focuses the control that matches the mark: the same label if there is one, else the same place; without scrolling. */
export function restoreFocus(root: HTMLElement, mark: FocusMark | null): void {
  if (!mark) return;
  const found = Array.from(root.querySelectorAll<HTMLElement>(mark.selector));
  const target = found.find((e) => (e.textContent ?? "") === mark.text) ?? found[Math.max(mark.index, 0)];
  target?.focus({ preventScroll: true });
}
