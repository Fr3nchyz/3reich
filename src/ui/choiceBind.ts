import { confirmAdvance, confirmLosses, pickLossWay, stayOut, toggleAdvance, toggleLoss } from "./choiceTap";
import type { Session } from "./session";

/** Click handlers for the losses and advance cards choiceView.ts draws. Each changes the session, then calls `redraw`. */

export function bindChoice(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));
  on<HTMLButtonElement>(".losscard button[data-pick]", (b) => toggleLoss(s, b.dataset.pick!));
  on<HTMLButtonElement>(".losscard button[data-lossway]", (b) => pickLossWay(s, Number(b.dataset.lossway)));
  on("#loss-go", () => confirmLosses(s));
  on<HTMLButtonElement>(".advancecard button[data-pick]", (b) => toggleAdvance(s, b.closest<HTMLElement>(".advancecard")!.dataset.to!, b.dataset.pick!));
  on<HTMLButtonElement>("button[data-advancego]", (b) => confirmAdvance(s, b.dataset.advancego!));
  on<HTMLButtonElement>("button[data-advancestay]", (b) => stayOut(s, b.dataset.advancestay!));
}
