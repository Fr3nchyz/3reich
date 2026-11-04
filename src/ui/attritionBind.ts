import type { Action } from "../engine/actions";
import { turnKey } from "../engine/combat-record";
import type { Front } from "../engine/map";
import type { GameState } from "../engine/types";
import { attritionModel, type AttritionButton, type AttritionChip, type AttritionSelection } from "./attritionView";
import { plural } from "./attackText";
import { computerToMove } from "./computerPlay";
import { escape as e, cornersOf, points } from "./mapGeometry";
import { placeName } from "./names";
import type { Session } from "./session";
import { takeAction } from "./sessionActions";

type Draft = { state: GameState; turn: string; selection: AttritionSelection; log: string[]; seen: number; result: string | null; focused?: string };
const drafts = new WeakMap<Session, Draft>();
function draft(s: Session): Draft {
  let d = drafts.get(s);
  const turn = turnKey(s.state);
  if (!d || d.turn !== turn || d.log !== s.log || s.log.length < d.seen) {
    d = { state: s.state, turn, selection: {}, log: s.log, seen: s.log.length, result: null };
    drafts.set(s, d);
  }
  if (d.state !== s.state) { d.state = s.state; d.selection = {}; }
  // Spec 16 D2/C4: the event-derived log survives even a whole computer run between draws.
  for (const line of s.log.slice(d.seen)) {
    const roll = line.match(/^Attrition on the .* \((Axis|Allies)\): .* column, die (\d): (\d+) units? lost, (\d+) hex(?:es)? may be taken\.$/);
    if (roll) d.result = `Die: ${roll[2]}. The ${roll[1] === "Axis" ? "Allies" : "Axis"} lose ${plural(Number(roll[3]), "unit")} and must give up ${plural(Number(roll[4]), "hex", "hexes")}.`;
  }
  d.seen = s.log.length;
  return d;
}
function model(s: Session) {
  return attritionModel(s.ctx, s.state, s.humanSide, draft(s).selection);
}
const disabled = (value: boolean) => value ? " disabled" : "";
function button(key: string, b: AttritionButton, locked: boolean): string {
  return `<button data-attrition-action="${key}"${disabled(locked || b.disabled)}>${e(b.text)}</button>`;
}
function chips(list: AttritionChip[], locked: boolean, front?: Front, selected?: string): string {
  return `<ul class="chips">${list.map((c) => `<li><button data-attrition-chip="${e(c.id)}"${front ? ` data-front="${front}"` : ""} aria-pressed="${selected ? selected === c.id : c.chosen}"${disabled(locked)}>${e(c.name)} from ${e(c.from)}; ${c.factors} factors${c.note ? `; ${e(c.note)}` : ""}</button></li>`).join("")}</ul>`;
}

/** Spec 16 D2/R2–R8: render only model choices; selection never changes the game. */
export function attritionHtml(s: Session): string {
  const d = draft(s), m = model(s);
  const result = m?.result ?? d.result;
  if (!m && !result) return "";
  const locked = computerToMove(s) || !!m?.readOnly;
  let html = result ? `<p class="attrition-result" role="status">${e(result)}</p>` : "";
  if (m) {
    html += `<h2 id="attrition-title" tabindex="-1">${e(m.heading)}</h2>${locked ? `<p role="status">${e(m.waiting ?? `The computer is choosing ${m.stage === "losses" ? "its losses" : "its Attrition action"}...`)}</p>` : ""}`;
    for (const f of m.fronts) html += `<section><h3>${e(f.heading)}</h3><p>${f.count} of your units: ${f.factors} factors. Column: ${e(f.column ?? "none")}.</p>${chips(f.chips, locked, f.front)}<ol class="attrition-results">${f.results.map((r) => `<li>${e(r.text)}</li>`).join("")}</ol>${button(f.front, f.confirm, locked)}</section>`;
    html += chips(m.chips, locked, undefined, m.stage === "retreat" ? d.selection.unit ?? m.chips[0]?.id : undefined);
    if (m.stage === "retreat") {
      const selected = d.selection.unit ?? m.chips[0]?.id;
      html += `<div class="attrition-hexes">${(m.chips.find((c) => c.id === selected)?.destinations ?? []).map((h) => `<button data-attrition-hex="${e(h)}"${disabled(locked)}>${e(placeName(s.ctx.map, h))}</button>`).join("")}</div>`;
    }
    if (m.tapped) html += `<section class="attrition-target"><h3>${e(m.tapped.name)}</h3><p>${e(m.tapped.reason ?? m.tapped.text)}</p><p>${m.tapped.defenders.length} defenders. Your units next to it:</p>${m.tapped.occupiers.map((c) => `<p>${e(c.name)} from ${e(c.from)}</p>`).join("")}${button("take", m.tapped.confirm, locked)}</section>`;
    if (m.stage !== "resolve") html += button("confirm", m.confirm, locked);
    if (m.stage === "losses" || m.stage === "retreat") html += button("auto", m.chooseForMe, locked);
    if (m.moveOn.action) html += button("next", m.moveOn, locked);
    html += m.overstack.map((o) => `<p class="attrition-overstack">${e(o.text)}</p>`).join("");
  }
  return `<section class="attrition-card" aria-label="Attrition">${html}</section>`;
}

/** Spec 16 D2/R5/R6: inspect a target or select a legal retreat, then confirm explicitly. */
export function attritionTap(s: Session, hex: string): boolean {
  const m = model(s);
  if (!m || computerToMove(s) || m.readOnly || (m.stage !== "hex" && m.stage !== "retreat")) return false;
  const d = draft(s);
  s.lookedAt = hex;
  d.selection.hex = hex;
  s.toast = "";
  if (m.stage === "retreat") {
    const id = d.selection.unit ?? m.chips[0]?.id;
    if (!m.chips.find((c) => c.id === id)?.destinations.includes(hex)) s.toast = "Choose a yellow hex for this counter.";
  }
  return true;
}

/** Spec 16 D2: all marks use the model's current legal destinations and selected participants. */
export function attritionMarks(s: Session): string {
  const m = model(s);
  if (!m || computerToMove(s) || m.readOnly) return "";
  const polygon = (h: string, kind: string) => `<polygon class="${kind}" points="${points(cornersOf(h))}"/>`;
  const participants = m.fronts.flatMap((f) => f.chips.filter((c) => c.chosen).map((c) => c.id));
  const from = [...new Set(participants.flatMap((id) => s.state.units[id] ? [s.state.units[id].at] : []))];
  const destinations = m.stage === "retreat" ? m.chips.find((c) => c.id === (draft(s).selection.unit ?? m.chips[0]?.id))?.destinations ?? [] : [];
  const target = m.stage === "occupy" ? s.state.attrition?.run?.target : undefined;
  return from.map((h) => polygon(h, "attrition-participant")).join("") + m.targets.map((h) => polygon(h, "attrition-target-mark")).join("")
    + destinations.map((h) => polygon(h, "attrition-retreat")).join("") + (target ? polygon(target, "attrition-move-in") : "");
}

/** Spec 16 D2/C3: re-read the model at each click; dispatch through the normal action path. */
export function bindAttrition(root: HTMLElement, s: Session, redraw: () => void): void {
  const layer = root.ownerDocument.querySelector("g.attrition-marks");
  if (layer) layer.innerHTML = attritionMarks(s);
  // Spec 16 D6: focus each newly opened stage once, preserving focus on chip redraws.
  const m = model(s), d = draft(s);
  const key = m ? `${m.stage}:${m.chooser}:${m.heading}:${d.selection.hex ?? ""}` : "";
  if (key && d.focused !== key) {
    d.focused = key;
    const heading = root.querySelector<HTMLElement>("#attrition-title");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "nearest" });
  }
  const on = (selector: string, f: (b: HTMLElement) => void) => root.querySelectorAll<HTMLElement>(selector).forEach((b) => b.addEventListener("click", () => {
    if (computerToMove(s) || model(s)?.readOnly) return;
    f(b); redraw();
  }));
  on("[data-attrition-chip]", (b) => {
    const m = model(s), d = draft(s), id = b.dataset.attritionChip!;
    if (!m) return;
    if (m.stage === "retreat") { d.selection = { unit: id }; return; }
    const front = b.dataset.front as Front | undefined;
    const list = front ? m.fronts.find((f) => f.front === front)?.chips : m.chips;
    if (!list?.some((c) => c.id === id)) return;
    const chosen = list.filter((c) => c.chosen).map((c) => c.id);
    d.selection = { front, units: chosen.includes(id) ? chosen.filter((u) => u !== id) : [...chosen, id] };
  });
  on("[data-attrition-hex]", (b) => { attritionTap(s, b.dataset.attritionHex!); });
  on("[data-attrition-action]", (b) => {
    const m = model(s);
    if (!m) return;
    const key = b.dataset.attritionAction;
    const a: Action | null | undefined = key === "confirm" ? m.confirm.action : key === "auto" ? m.chooseForMe.action
      : key === "take" ? m.tapped?.confirm.action : key === "next" ? m.moveOn.action : m.fronts.find((f) => f.front === key)?.confirm.action;
    if (a) takeAction(s, a);
  });
}
