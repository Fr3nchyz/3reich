import { describeStep } from "../engine/sequence";
import { computerSide } from "./computerPlay";
import { cap, sideName } from "./format";
import type { Session } from "./session";
import { beginStep, isRunning, overOf, pause, play, setSpeed, SPEEDS, SPEED_ORDER, type Speed, type WatchInfo } from "./watchController";
import { endText, recordFor, stuckText } from "./watchPlay";
import { downloadRecord } from "./watchRecord";
import type { Side } from "../engine/types";
import { escape } from "./mapGeometry";
import { summarise, summaryHtml } from "./watchSummary";

/** The watch-mode control bar under the map and the watch panel at the top of the status column (spec 06): text from the session, and the wiring of their buttons. */

/** The one status line: scenario, Game Turn, side to move, step, action count, side acting. */
export function statusLine(s: Session): string {
  const { state } = s;
  const w = s.watch!;
  const parts = [s.ctx.scenario.name, `Game Turn ${cap(state.season)} ${state.year}`];
  if (state.phase === "player-turn") {
    parts.push(`${sideName(state.activeSide)} to move`);
    if (state.position?.part === "player-turn") parts.push(`step ${describeStep(state.position.step)}`);
  }
  parts.push(`action ${w.actions}`);
  if (state.phase === "player-turn" && !w.stuck && !overOf(w, state)) parts.push(`${sideName(computerSide(s))} acting`);
  parts.push(stateWord(s) === "running" ? `running (${SPEEDS[w.speed].label})` : stateWord(s));
  return parts.join(" · ");
}

/** The state of a watched game in one word: what the status line ends with. */
export const stateWord = (s: Session): string => {
  const w = s.watch!;
  return w.stuck ? "stuck" : overOf(w, s.state) ? "ended" : !isRunning(w) ? "paused" : "running";
};

/** A number per session, so that a panel is never kept from one game into the next. */
const ids = new WeakMap<Session, number>();
let lastId = 0;
const gameId = (s: Session): number => ids.get(s) ?? ids.set(s, ++lastId).get(s)!;

/** The panel's HTML: the stuck message, the End of game summary, and the buttons that are not in the bar. */
export function panelHtml(s: Session): string {
  const w = s.watch!;
  const stuck = stuckText(s);
  const end = endText(s);
  const gameOver = overOf(w, s.state) === "game-over"; // after the chosen Game Turn limit the game can still be taken over and played on
  return `<section class="watch-panel" aria-label="Watching two computers" data-key="${[gameId(s), !!stuck, gameOver, end ?? ""].join("|")}">
    ${stuck ? `<p class="watch-stuck" role="alert">${escape(stuck)} The position is left as it is: look at the map and the log, or save the record.</p>` : ""}
    ${end ? summaryHtml(summarise(s.ctx, s.state), end) : ""}
    <div class="actions controls">
      <button id="w-save" type="button">Save game record</button>
      <button id="w-take-axis" type="button" ${gameOver ? "disabled" : ""}>Take over as Axis</button>
      <button id="w-take-allies" type="button" ${gameOver ? "disabled" : ""}>Take over as Allies</button>
      <button id="w-stop" type="button">Stop watching</button>
    </div>
    <p class="note">Seed ${s.seed} (type it in the menu to repeat this game). The opening setup took ${w.setupActions} actions.</p>
  </section>`;
}

export const speedOptions = (): string => SPEED_ORDER.map((k) => `<option value="${k}">${SPEEDS[k].label}</option>`).join("");

/** Draws the bar from the session; hides it when no watched game is on. */
export function drawBar(bar: HTMLElement, s: Session): void {
  bar.hidden = !s.watch;
  document.body.classList.toggle("watching", !!s.watch);
  if (!s.watch) return;
  const w = s.watch;
  const live = !w.stuck && overOf(w, s.state) === null;
  const q = <T extends HTMLElement>(id: string) => bar.querySelector<T>(`#${id}`)!;
  q("w-play").textContent = isRunning(w) ? "Pause" : "Play";
  for (const id of ["w-play", "w-step", "w-turn"]) q<HTMLButtonElement>(id).disabled = !live;
  q<HTMLSelectElement>("w-speed").value = w.speed;
  q("w-status").textContent = statusLine(s);
  // A screen reader hears only changes of state (paused, running, ended, stuck), not every action.
  const state = stateWord(s);
  if (bar.dataset.state !== state) {
    bar.dataset.state = state;
    q("w-announce").textContent = state === "stuck" ? stuckText(s) : `Watching: ${state}.`;
  }
}

/** Wires the bar's controls once; they change whatever session `current` returns, then `changed` drops a waiting timer and draws. */
export function bindBar(bar: HTMLElement, current: () => Session, changed: () => void): void {
  const q = <T extends HTMLElement>(id: string) => bar.querySelector<T>(`#${id}`)!;
  q("w-speed").innerHTML = speedOptions();
  q<HTMLSelectElement>("w-speed").value = "normal";
  const edit = (f: (w: WatchInfo, s: Session) => WatchInfo) => () => {
    const s = current();
    if (s.watch) s.watch = f(s.watch, s);
    changed();
  };
  q("w-play").addEventListener("click", edit((w) => (isRunning(w) ? pause(w) : play(w))));
  q("w-step").addEventListener("click", edit((w, s) => beginStep(w, "action", s.state)));
  q("w-turn").addEventListener("click", edit((w, s) => beginStep(w, "turn", s.state)));
  q<HTMLSelectElement>("w-speed").addEventListener("change", edit((w) => setSpeed(w, q<HTMLSelectElement>("w-speed").value as Speed)));
}

export interface PanelHooks {
  stop: () => void;
  takeOver: (side: Side) => void;
}

/**
 * After the status column is redrawn, puts the old panel back in place of the new one when nothing in it changed (same
 * `data-key`): the buttons then stay the same elements through the many redraws of a fast game, so a click on one is
 * never lost to a redraw between pressing and releasing.
 */
export function keepPanel(root: HTMLElement, old: HTMLElement | null): void {
  const fresh = root.querySelector<HTMLElement>(".watch-panel");
  if (old && fresh && old.dataset.key === fresh.dataset.key) fresh.replaceWith(old);
}

/** Wires the panel's buttons after each redraw of the status column (once per panel element). */
export function bindPanel(root: HTMLElement, s: Session, hooks: PanelHooks): void {
  const panel = root.querySelector<HTMLElement>(".watch-panel");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";
  const on = (id: string, f: () => void) => root.querySelector(`#${id}`)?.addEventListener("click", f);
  // The session is replaced by a new game, and the panel with it, so `s` stays the right one; the record is read when the button is pressed.
  on("w-save", () => downloadRecord(recordFor(s)));
  on("w-take-axis", () => hooks.takeOver("axis"));
  on("w-take-allies", () => hooks.takeOver("allies"));
  on("w-stop", hooks.stop);
}
