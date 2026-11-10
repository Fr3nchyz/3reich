import type { GameState } from "../engine/types";
import { airSeaModel, type AirSeaDraft } from "./airSeaModel";
import { escape as e } from "./mapGeometry";
import { SEA_AIR_TEXT as T } from "./navalText";
import { revealHeading, showTop } from "./reveal";
import type { Session } from "./session";
import { takeAction } from "./sessionActions";

type Screen = { state: GameState; draft: AirSeaDraft; dismissed: unknown; focused: string };
const screens = new WeakMap<Session, Screen>();
function screen(s: Session): Screen {
  let d = screens.get(s);
  if (!d || d.state !== s.state) {
    d = { state: s.state, draft: {}, dismissed: d?.dismissed, focused: "" };
    screens.set(s, d);
  }
  return d;
}
const model = (s: Session) => s.watch ? null : airSeaModel(s.ctx, s.state, s.humanSide, screen(s).draft);
const button = (id: string, text: string, disabled = false) => `<button type="button" class="way" id="sea-air-${id}"${disabled ? " disabled" : ""}>${e(text)}</button>`;
const rows = (items: { id: string; text: string; chosen: boolean }[], kind: string) => `<ul class="stack-rows">${items.map(p => `<li><button type="button" class="plane-row" id="sea-air-${kind}-${e(p.id)}" data-sea-air-${kind}="${e(p.id)}" aria-pressed="${p.chosen}">${e(p.text)}</button></li>`).join("")}</ul>`;
const card = (id: string, title: string, body: string) => `<section class="attackcard sea-air-card" aria-labelledby="${id}"><h2 id="${id}" tabindex="-1">${e(title)}</h2>${body}</section>`;

/** Spec 12 D5: accessible rows over the pure model; draft state is never saved. */
export function airSeaHtml(s: Session): string {
  const m = model(s);
  if (!m) return "";
  const choose = m.planes.length ? `<p>${e(T.note)}</p><h3>${e(T.planes)}</h3>${rows(m.planes, "plane")}<p role="status">${e(T.chosen(m.factors))}</p><h3>${e(T.target)}</h3>${rows(m.targets, "target")}<h3>${e(T.point)}</h3>${rows(m.points, "point")}${button("confirm", T.confirm, !m.action)}${button("cancel", T.cancel)}` : "";
  const assigned = m.assigned.length ? `<h3>${e(T.assigned)}</h3><ul>${m.assigned.map(a => `<li>${e(T.assignment(a.target, a.point, a.planes))}</li>`).join("")}</ul>` : "";
  return (choose || assigned || m.resolve ? card("sea-air-title", T.title, choose + assigned + (m.resolve ? button("resolve", T.resolve) : "")) : "") +
    (m.results.length && screen(s).dismissed !== s.state.naval?.seaAirResults ? card("sea-air-results-title", T.results, `<div role="status">${m.results.map(r => `<h3>${e(r.title)}</h3>${r.lines.map(l => `<p>${e(l)}</p>`).join("")}`).join("")}</div>${button("close", T.close)}`) : "");
}

export function bindAirSea(root: HTMLElement, s: Session, redraw: () => void): void {
  const boundState = s.state;
  const on = (selector: string, f: (b: HTMLElement) => void) => root.querySelectorAll<HTMLElement>(selector).forEach(b => b.addEventListener("click", () => {
    if (s.state !== boundState || s.watch) return;
    f(b); redraw();
  }));
  on("[data-sea-air-plane]", b => {
    const m = model(s), id = b.dataset.seaAirPlane;
    if (!m?.planes.some(p => p.id === id)) return;
    screen(s).draft.units = m.planes.filter(p => p.id === id ? !p.chosen : p.chosen).map(p => p.id);
  });
  on("[data-sea-air-target]", b => {
    if (!model(s)?.targets.some(t => t.id === b.dataset.seaAirTarget)) return;
    Object.assign(screen(s).draft, { target: b.dataset.seaAirTarget, point: undefined });
  });
  on("[data-sea-air-point]", b => {
    if (model(s)?.points.some(p => p.id === b.dataset.seaAirPoint)) screen(s).draft.point = b.dataset.seaAirPoint;
  });
  on("#sea-air-cancel", () => { screen(s).draft = {}; });
  on("#sea-air-close", () => { screen(s).dismissed = s.state.naval?.seaAirResults; });
  on("#sea-air-confirm", () => { const a = model(s)?.action; if (a) takeAction(s, a); });
  on("#sea-air-resolve", () => { const a = model(s)?.resolve; if (a) takeAction(s, a); });
  root.querySelectorAll(".sea-air-card").forEach(c => c.addEventListener("keydown", event => {
    if ((event as KeyboardEvent).key !== "Escape" || s.state !== boundState || s.watch) return;
    screen(s).draft = {}; screen(s).dismissed = s.state.naval?.seaAirResults; redraw();
  }));
  const d = screen(s);
  const heading = root.querySelector<HTMLElement>("#sea-air-results-title") ?? root.querySelector<HTMLElement>("#sea-air-title");
  if (heading && d.focused !== heading.id) { d.focused = heading.id; revealHeading(heading, showTop); }
}
