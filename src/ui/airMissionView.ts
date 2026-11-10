import type { GameState } from "../engine/types";
import { airMissionKey, airMissionModel, type AirMissionDraft } from "./airMissionModel";
import { computerToMove } from "./computerPlay";
import { escape as e } from "./mapGeometry";
import type { Session } from "./session";
import { takeAction } from "./sessionActions";
import * as T from "./airText";

// Drafts belong to an exact screen state; any accepted action or restored state drops them.
const drafts = new WeakMap<Session, { state: GameState; picks: AirMissionDraft[] }>();
const draft = (s: Session) => drafts.get(s)?.state === s.state ? drafts.get(s)?.picks : undefined;
const model = (s: Session) => s.watch || computerToMove(s) ? null : airMissionModel(s.ctx, s.state, s.humanSide, draft(s));

/** Thin HTML over pure mission and event models; spec 09 D3/D4/D6. Existing card/chip styles supply touch sizes. */
export function airMissionHtml(s: Session): string {
  const m = model(s);
  const results = !s.watch && s.airResults?.key === airMissionKey(s.state) ? s.airResults.cards : [];
  const card = m ? `<section class="attackcard" aria-labelledby="air-mission-title"><h2 id="air-mission-title" tabindex="-1">${e(m.title)}</h2>
    <p>${e(m.note)}</p>${m.assigned.map(a => `<h3>${e(a.place)}</h3><ul>${a.planes.map(p => `<li>${e(p)}</li>`).join("")}</ul>`).join("")}
    ${m.choices.map((c) => `<div><h3>${e(c.place)}</h3>${c.committed.length ? `<p>${e(T.missionCommitted(c.committed))}</p>` : ""}
      <ul class="chips attack-chips">${c.chips.map((p) => `<li><button type="button" id="air-mission-${e(c.target)}-plane-${e(p.id)}" class="chip" data-mission-target="${e(c.target)}" data-mission-plane="${e(p.id)}" aria-pressed="${p.chosen}"><span class="chip-mark">${p.chosen ? T.MARK_CHOSEN : T.MARK_FREE}</span><span class="chip-name">${e(p.text)}</span></button></li>`).join("")}</ul>
      <p role="status">${e(T.missionChosen(c.factors))}</p><button type="button" id="air-mission-commit-${e(c.target)}" data-mission-commit="${e(c.target)}"${c.action ? "" : " disabled"}>${e(m.title === T.MISSION_TITLES["7d"] ? T.MISSION_COMMIT : T.MISSION_INTERCEPT)}: ${e(c.place)}</button></div>`).join("")}
    <div class="attack-foot">${m.resolve ? `<button type="button" id="air-mission-resolve">${T.MISSION_RESOLVE}</button>` : ""}${m.pass ? `<button type="button" id="air-mission-pass">${e(m.passText)}</button>` : ""}</div></section>` : "";
  return card + (results.length ? `<section class="attackcard" aria-labelledby="air-results-title"><h2 id="air-results-title">${T.MISSION_RESULTS}</h2>${results.map(r => `<h3>${e(r.title)}</h3>${r.lines.map(l => `<p>${e(l)}</p>`).join("")}`).join("")}</section>` : "");
}

export function toggleMissionPlane(s: Session, target: string, id: string): void {
  const c = model(s)?.choices.find(c => c.target === target);
  if (!c?.chips.some(p => p.id === id)) return;
  const units = c.chips.filter(p => p.id === id ? !p.chosen : p.chosen).map(p => p.id);
  drafts.set(s, { state: s.state, picks: [...(draft(s) ?? []).filter(d => d.target !== target), { target, units }] });
}
export function takeAirMission(s: Session, command: string): void {
  const m = model(s);
  const action = command === "resolve" ? m?.resolve : command === "pass" ? m?.pass : m?.choices.find(c => c.target === command)?.action;
  if (action) takeAction(s, action);
}
export function bindAirMission(root: HTMLElement, s: Session, redraw: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-mission-plane]").forEach(b => b.addEventListener("click", () => {
    toggleMissionPlane(s, b.dataset.missionTarget!, b.dataset.missionPlane!); redraw();
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-mission-commit], #air-mission-resolve, #air-mission-pass").forEach(b => b.addEventListener("click", () => {
    takeAirMission(s, b.dataset.missionCommit ?? (b.id === "air-mission-resolve" ? "resolve" : "pass")); redraw();
  }));
}
