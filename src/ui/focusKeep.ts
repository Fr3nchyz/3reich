/**
 * The status area is redrawn from scratch after every change, which drops the keyboard focus to the page.
 * These two functions note which control inside it had focus and give it back, but only when the new HTML
 * has that very control: found by a stable key (an id, a counter, a mode, the log's class) or, for buttons
 * that have none, by exactly the same label. Never "the one in the same place": after an action the list of
 * choices has changed, and a different button taking the focus could be an irreversible move. If the control
 * is gone the focus rests on the status panel itself. Focus that was elsewhere is never touched.
 */

/** data-* attributes whose value names the control for good (unlike data-action, an index into a list that changes). */
const STABLE_DATA = ["spec", "mode", "build", "box", "buildbox", "unit", "target"];

export interface FocusMark {
  /** Focus was on the status panel itself (where an earlier redraw left it). */
  panel: boolean;
  selector: string;
  /** The control has no stable key: only a control with exactly this label will do. */
  exactText: string | null;
}

/** How to find a control again: [selector, whether only the exact label tells it apart]. */
function keyOf(el: HTMLElement): [string, boolean] {
  const tag = el.tagName.toLowerCase();
  if (el.id) return [`#${CSS.escape(el.id)}`, false];
  for (const key of STABLE_DATA) {
    const v = el.dataset[key];
    if (v !== undefined) return [`${tag}[data-${key}="${v.replace(/["\\]/g, "\\$&")}"]`, false];
  }
  if (el.dataset.action !== undefined) return [`${tag}[data-action]`, true];
  return el.classList.length ? [`${tag}.${CSS.escape(el.classList[0]!)}`, false] : [tag, true];
}

export function captureFocus(root: HTMLElement): FocusMark | null {
  const el = document.activeElement;
  if (el === root) return { panel: true, selector: "", exactText: null };
  if (!(el instanceof HTMLElement) || !root.contains(el)) return null;
  const [selector, exact] = keyOf(el);
  return { panel: false, selector, exactText: exact ? el.textContent ?? "" : null };
}

/** Focuses the same control, or else the panel; without scrolling, and not at all if it already has the focus. */
export function restoreFocus(root: HTMLElement, mark: FocusMark | null): void {
  if (!mark) return;
  const found = mark.panel ? [] : Array.from(root.querySelectorAll<HTMLElement>(mark.selector));
  const target = (mark.exactText === null ? found[0] : found.find((e) => (e.textContent ?? "") === mark.exactText)) ?? root;
  if (target !== document.activeElement) target.focus({ preventScroll: true });
}
