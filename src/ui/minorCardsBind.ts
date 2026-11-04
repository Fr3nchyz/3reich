import { applyAction, legalActions, type Action, type GameEvent } from "../engine/actions";
import type { GameState } from "../engine/types";
import { POWER_NAMES } from "../engine/nations";
import { conquestLine } from "./conquestText";
import { computerToMove } from "./computerPlay";
import { escape as e } from "./mapGeometry";
import { dutyWarning, interventionCards, minorConquestLine, nextYearStartCards, wakeCards } from "./minorCards";
import { minorAuto } from "./minorBind";
import { selectionNow } from "./moveTap";
import type { Session } from "./session";
import { takeAction } from "./sessionActions";

type Screen = { state: GameState; count: number; last?: Action; events: GameEvent[]; warning?: Action; fresh: boolean };
const screens = new WeakMap<Session, Screen>();

/** Spec 15 D3–D5: recover actual events from newly accepted actions, without changing the session.
 * The allowed binding slice has no session event hook. Observe before the first action and after each render;
 * batches use the previous result as input. Loading or undoing drops the transient cards.
 */
export function observeMinorCards(s: Session): void {
  const old = screens.get(s);
  if (old?.state === s.state) return;
  const events: GameEvent[] = [];
  if (old && s.record.length > old.count && s.record[old.count - 1] === old.last) {
    let state = old.state;
    for (const action of s.record.slice(old.count)) {
      const result = applyAction(s.ctx, state, action);
      if (!result.ok) { events.length = 0; break; }
      state = result.state;
      events.push(...result.events);
    }
  }
  screens.set(s, { state: s.state, count: s.record.length, last: s.record.at(-1), events, fresh: true });
}
function screen(s: Session): Screen { observeMinorCards(s); return screens.get(s)!; }

/** Spec 15 R4 D3/Q5: every ordinary End combat button goes through this screen check. */
export function takeMinorAction(s: Session, action: Action): void {
  if (computerToMove(s)) return;
  const d = screen(s);
  if (dutyWarning(s.state, action)) { d.warning = action; d.fresh = true; }
  else takeAction(s, action);
}

/** Spec 15 R13 D6: estimates and the exact engine income lines, alongside the nation table. */
export function nextYearHtml(s: Session): string {
  if (s.state.phase === "setup" || s.state.phase === "game-over") return "";
  return `<section class="minor-income" aria-label="Next year start"><h2>Next year start</h2><p class="note">Estimate from current cash and holdings. Spending, growth and changes of control can change it.</p>${nextYearStartCards(s.ctx, s.state).map((m) => `<details><summary>${POWER_NAMES[m.nation]}: Base ${m.base} + territory ${m.lines.reduce((sum, l) => sum + l.value, 0)} = ${m.total} BRPs — ${m.why}</summary><p>Base includes growth of ${m.growth} BRPs.</p><ul>${m.lines.map((l) => `<li>${e(l.name)}: ${l.value} BRPs (${e(l.reason)})</li>`).join("")}</ul></details>`).join("")}</section>`;
}

/** Spec 15 R4/R6/R7/R9 D3–D5: render model text; eligibility and values stay in the engine/model. */
export function minorCardsHtml(s: Session, actions: readonly Action[]): string {
  const d = screen(s);
  const warning = d.warning && !computerToMove(s) ? dutyWarning(s.state, d.warning) : null;
  const card = (title: string, body: string) => `<section class="minor-card minor-event" aria-label="${title}"><h2 tabindex="-1">${title}</h2>${body}</section>`;
  let html = warning ? `<section class="minor-card minor-warning" role="alertdialog" aria-labelledby="minor-warning-title" aria-describedby="minor-warning-lines"><h2 id="minor-warning-title" tabindex="-1">${e(warning.title)}</h2><div id="minor-warning-lines">${warning.lines.map((l) => `<p>${e(l)}</p>`).join("")}</div><button id="minor-back">${warning.back.text}</button><button id="minor-end-combat">${warning.confirm.text}</button></section>` : "";
  html += interventionCards(d.events).map((m) => card("Intervention", `<p>${e(m.text)}</p>`)).join("");
  html += wakeCards(d.events).map((m) => card("Minor allies wake", `<p>${e(m.text)}</p>${m.buttons.length && !computerToMove(s) && actions.some((a) => a.type === "PLACE_MINOR_FORCES" && m.toPlace.includes(a.minor)) ? '<button id="minor-wake-auto">Place automatically</button>' : ""}`)).join("");
  html += d.events.map((event) => {
    const line = minorConquestLine(s.ctx, s.state, event);
    return line ? card("Conquest", `<p>${e(conquestLine(s.ctx, event) ?? "")}</p><p>${e(line.text)}</p>`) : "";
  }).join("");
  if (!computerToMove(s) && selectionNow(s)) html += '<p id="minor-intervention-preview" role="status"></p>';
  return html;
}

/** Spec 15 R6 D3: preview only the selected stack's engine-confirmed entry result. */
export function previewMinorMove(root: HTMLElement, s: Session, hex?: string): void {
  const target = root.querySelector<HTMLElement>("#minor-intervention-preview");
  if (!target) return;
  const sel = !computerToMove(s) ? selectionNow(s) : null;
  const dest = sel?.destinations.find((d) => d.to === hex);
  const result = sel && dest ? applyAction(s.ctx, s.state, { type: "MOVE", side: s.state.activeSide, units: sel.ticked, path: dest.path }) : null;
  target.textContent = result?.ok ? interventionCards(result.events).map((m) => m.text).join(" ") : "";
}

export function bindMinorCards(root: HTMLElement, s: Session, redraw: () => void): void {
  const on = (id: string, f: () => void) => root.querySelector(id)?.addEventListener("click", () => { f(); redraw(); });
  on("#minor-back", () => { delete screen(s).warning; });
  on("#minor-end-combat", () => {
    const d = screen(s), action = d.warning;
    // Spec 15 R4 D3: revalidate after a replacement state; never dispatch a stale confirmation.
    if (!computerToMove(s) && action && dutyWarning(s.state, action)
      && legalActions(s.ctx, s.state).some((a) => a.type === "END_STEP" && a.step === "7h" && a.side === s.humanSide)) {
      delete d.warning;
      takeAction(s, action);
    }
  });
  // Spec 15 R9 D5 / R16: same editable draft as the ordinary placement panel; Done submits it.
  on("#minor-wake-auto", () => minorAuto(s, legalActions(s.ctx, s.state)));
  root.querySelectorAll<HTMLElement>("button.dest-row").forEach((b) => {
    for (const event of ["pointerenter", "focus"]) b.addEventListener(event, () => previewMinorMove(root, s, b.dataset.dest));
    for (const event of ["pointerleave", "blur"]) b.addEventListener(event, () => previewMinorMove(root, s));
  });
  const d = screen(s);
  if (d.fresh) {
    const heading = root.querySelector<HTMLElement>("#minor-warning-title, .minor-event h2");
    if (heading) { heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: "nearest" }); }
    d.fresh = false;
  }
}
