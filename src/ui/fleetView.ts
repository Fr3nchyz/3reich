import { turnKey } from "../engine/combat-record";
import { computerToMove } from "./computerPlay";
import { sideName } from "./format";
import { fleetInterceptModel } from "./fleetModel";
import { escape as e } from "./mapGeometry";
import { FLEET_TEXT as T } from "./navalText";
import { revealHeading, showTop } from "./reveal";
import type { Session } from "./session";
import { fleetScreen as screen, updateFleet as update, fleetNow, confirmFleet } from "./fleetTap";

const button = (id: string, text: string, disabled = false) => `<button type="button" class="way" id="fleet-${id}"${disabled ? " disabled" : ""}>${e(text)}</button>`;
const rows = (items: { id: string; name: string; selected?: boolean }[], key: string) => `<ul class="stack-rows">${items.map(t => `<li><button type="button" class="plane-row" data-${key}="${e(t.id)}" aria-pressed="${!!t.selected}">${e(t.name)}</button></li>`).join("")}</ul>`;
const card = (title: string, body: string, id = "fleet-title") => `<section class="attackcard fleetcard" aria-labelledby="${id}"><h2 id="${id}" tabindex="-1">${e(title)}</h2>${body}</section>`;

/** Spec 12 D3/D5: HTML over pure models; existing row/way styles give 44 px targets. */
export function fleetHtml(s: Session): string {
  const d = screen(s), results = s.fleetResults;
  let html = !s.watch && results?.turn === turnKey(s.state)
    ? card(T.results, `<div role="status">${results.lines.map(l => `<p>${e(l)}</p>`).join("")}</div>${button("results-close", T.close)}`, "fleet-results-title") : "";
  if (s.watch || computerToMove(s) || s.state.naval?.manualFleetMove !== true) return html;
  const m = fleetNow(s);
  if (m) {
    const fleets = rows(m.fleets.map(f => ({ ...f, selected: m.selected?.id === f.id })), "fleet");
    const dests = rows(m.destinations.map(p => ({ id: p.key, name: p.name, selected: d.draft.destination === p.key })), "fleetdest");
    html += card(T.move, `<p>${e(T.select)}</p>${fleets}${dests}${button("confirm", T.confirm, !m.action)}${button("cancel", T.cancel)}${m.end ? button("done", T.done) : ""}`);
  } else {
    const p = fleetInterceptModel(s.ctx, s.state, d.draft);
    if (p.pass) {
      const targets = rows(p.targets.map(t => ({ ...t, selected: p.target?.id === t.id })), "fleettarget");
      const points = rows(p.meetings.map(t => ({ ...t, selected: p.point === t.id })), "fleetpoint");
      const fleets = rows(p.fleets.map(f => ({ ...f, name: `${f.name} — ${T.reach(f.distance, f.needed)}` })), "interceptfleet");
      html += card(T.intercept, `<p role="status">${e(T.answering(sideName(p.side ?? p.pass.side)))}</p>${p.targets.length ? `<h3>${e(T.target)}</h3>${targets}<h3>${e(T.meeting)}</h3>${points}${fleets}<button type="button" class="way" id="fleet-break" aria-pressed="${p.breakOff}">${e(T.breakOff)}</button>${button("intercept", T.declare, !p.action)}` : `<p>${e(T.noTargets)}</p>`}${button("pass", T.pass)}`);
    }
    if (p.resolve) html += card(T.resolve, `<p>${e(T.automaticLosses)}</p>${button("resolve", T.resolve)}`);
  }
  return html;
}
export function bindFleet(root: HTMLElement, s: Session, redraw: () => void): void {
  const boundState = s.state;
  const on = (selector: string, f: (b: HTMLElement) => void) => root.querySelectorAll<HTMLElement>(selector).forEach(b => b.addEventListener("click", () => { if (s.state !== boundState || s.watch || (computerToMove(s) && selector !== "#fleet-results-close")) return; f(b); redraw(); }));
  on("[data-fleet]", b => update(s, { fleet: b.dataset.fleet, destination: undefined }));
  on("[data-fleetdest]", b => update(s, { destination: b.dataset.fleetdest }));
  on("[data-fleettarget]", b => update(s, { target: b.dataset.fleettarget, point: undefined, fleets: undefined }));
  on("[data-fleetpoint]", b => update(s, { point: b.dataset.fleetpoint, fleets: undefined }));
  on("[data-interceptfleet]", b => {
    const p = fleetInterceptModel(s.ctx, s.state, screen(s).draft);
    update(s, { fleets: p.fleets.filter(f => f.id === b.dataset.interceptfleet ? !f.selected : f.selected).map(f => f.id) });
  });
  on("#fleet-break", () => update(s, { breakOff: !screen(s).draft.breakOff }));
  on("#fleet-cancel", () => { screen(s).draft = {}; });
  on("#fleet-results-close", () => { s.fleetResults = null; });
  for (const [id, kind] of [["confirm", "move"], ["intercept", "intercept"], ["pass", "pass"], ["resolve", "resolve"], ["done", "end"]] as const) on(`#fleet-${id}`, () => confirmFleet(s, kind));
  root.querySelectorAll(".fleetcard").forEach(c => c.addEventListener("keydown", event => {
    if ((event as KeyboardEvent).key === "Escape") { screen(s).draft = {}; s.fleetResults = null; redraw(); }
  }));
  const d = screen(s), r = s.fleetResults;
  if (d.fresh || r?.fresh) {
    const heading = root.querySelector<HTMLElement>(r?.fresh ? "#fleet-results-title" : "#fleet-title");
    if (heading) revealHeading(heading, showTop);
    d.fresh = false;
    if (r) r.fresh = false;
  }
}
