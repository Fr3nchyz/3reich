import type { Action } from "../engine/actions";
import type { OffMapBox } from "../engine/types";
import { bindAir } from "./airBind";
import { bindAttack } from "./attackBind";
import { bindChoice } from "./choiceBind";
import { bindMove } from "./moveBind";
import type { Session, SetupView, TapMode } from "./session";
import { buildInBox, closeLook, fillRest, finishOwner, pickBuild, pickSpec, placeInBox, setMode, takeAction, undoLast } from "./sessionActions";

/** Click handlers for the buttons statusView draws. Each one changes the session, then calls `redraw`. */

export function bindStatus(root: HTMLElement, s: Session, setup: SetupView | null, actions: Action[], redraw: () => void): void {
  const owner = setup?.owner;
  const spec = setup?.spec ?? null;
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));

  on<HTMLButtonElement>("button[data-action]", (b) => takeAction(s, actions[Number(b.dataset.action)]!));
  on<HTMLButtonElement>("button[data-mode]", (b) => setMode(s, b.dataset.mode as TapMode));
  on<HTMLButtonElement>("button[data-spec]", (b) => pickSpec(s, b.dataset.spec!));
  on<HTMLButtonElement>("button[data-build]", (b) => pickBuild(s, b.dataset.build!));
  on<HTMLButtonElement>("button[data-buildbox]", (b) => buildInBox(s, b.dataset.buildbox as OffMapBox));
  on<HTMLButtonElement>("button[data-box]", (b) => { if (owner) placeInBox(s, owner, spec, b.dataset.box as OffMapBox); });
  bindAttack(root, s, redraw);
  bindAir(root, s, redraw);
  bindChoice(root, s, redraw);
  bindMove(root, s, redraw);
  on("#hexcard-close", () => closeLook(s));
  root.querySelector(".hexcard")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") { closeLook(s); redraw(); }
  });
  on("#undo", () => { if (owner) undoLast(s, owner); });
  on("#fill", () => fillRest(s));
  on("#done", () => { if (owner) finishOwner(s, owner); });
}
