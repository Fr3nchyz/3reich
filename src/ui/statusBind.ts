import type { Action } from "../engine/actions";
import type { OffMapBox } from "../engine/types";
import { winterKey } from "../engine/winter-record";
import { bindMinor } from "./minorBind";
import { bindAir } from "./airBind";
import { bindAirMove } from "./airMoveBind";
import { bindAttack } from "./attackBind";
import { bindChoice } from "./choiceBind";
import { bindMove } from "./moveBind";
import { bindRedeploy } from "./redeployBind";
import type { Session, SetupView, TapMode } from "./session";
import { buildInBox, closeLook, fillRest, finishOwner, pickBuild, pickSiberian, pickSpec, placeInBox, setMode, takeAction, takeSiberian, undoLast } from "./sessionActions";
import { turnKey } from "../engine/victory";

/** Click handlers for the buttons statusView draws. Each one changes the session, then calls `redraw`. */

/** After the Free Siberian Transfer card first appears in a Game Turn its heading takes the keyboard focus, once, and the card is scrolled into view; a card of an earlier Game Turn is forgotten (the style of `revealWinter`). */
function revealSiberian(root: HTMLElement, s: Session): void {
  const card = root.querySelector<HTMLElement>("#siberian-card");
  const key = turnKey(s.state);
  if (!card) { if (s.siberianFocused === key) s.siberianFocused = undefined; return; }
  if (s.siberianFocused === key) return;
  s.siberianFocused = key;
  root.querySelector<HTMLElement>("#siberian-title")?.focus({ preventScroll: true });
  card.scrollIntoView({ block: "nearest" });
}

export function bindStatus(root: HTMLElement, s: Session, setup: SetupView | null, actions: Action[], redraw: () => void): void {
  const owner = setup?.owner;
  const spec = setup?.spec ?? null;
  const on = <T extends HTMLElement>(selector: string, handler: (el: T) => void) =>
    root.querySelectorAll<T>(selector).forEach((el) => el.addEventListener("click", () => { handler(el); redraw(); }));

  on<HTMLButtonElement>("button[data-action]", (b) => takeAction(s, actions[Number(b.dataset.action)]!));
  on<HTMLButtonElement>("button[data-winterwhy]", (b) => { s.foldOpen = true; s.toast = b.title; }); // the greyed Offensive Option: a tap says why (the winter, ticket 14-13)
  on("#winter-ok", () => { s.winterSeen = winterKey(s.state); });
  on<HTMLButtonElement>("button[data-mode]", (b) => setMode(s, b.dataset.mode as TapMode));
  on<HTMLButtonElement>("button[data-spec]", (b) => pickSpec(s, b.dataset.spec!));
  on<HTMLButtonElement>("button[data-build]", (b) => pickBuild(s, b.dataset.build!));
  on<HTMLButtonElement>("button[data-buildbox]", (b) => buildInBox(s, b.dataset.buildbox as OffMapBox));
  on<HTMLButtonElement>("button[data-siberian]", (b) => pickSiberian(s, b.dataset.siberian!));
  on<HTMLButtonElement>("button[data-siberian-city]", (b) => takeSiberian(s, b.dataset.siberianCity!));
  on<HTMLButtonElement>("button[data-box]", (b) => { if (owner) placeInBox(s, owner, spec, b.dataset.box as OffMapBox); });
  bindMinor(root, s, actions, redraw);
  bindAttack(root, s, redraw);
  bindAir(root, s, redraw);
  bindAirMove(root, s, redraw);
  bindChoice(root, s, redraw);
  bindMove(root, s, redraw);
  bindRedeploy(root, s, redraw);
  on("#hexcard-close", () => closeLook(s));
  root.querySelector(".hexcard")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") { closeLook(s); redraw(); }
  });
  on("#undo", () => { if (owner) undoLast(s, owner); });
  on("#fill", () => fillRest(s));
  on("#done", () => { if (owner) finishOwner(s, owner); });
  revealSiberian(root, s);
}
