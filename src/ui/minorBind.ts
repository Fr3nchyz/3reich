import { legalActions, type Action } from "../engine/actions";
import type { GameState, MinorCountry, PowerId } from "../engine/types";
import type { MinorPlacement } from "../engine/minors-place";
import { MINOR_COUNTRIES } from "../engine/minors-ids";
import { sideOfOwner } from "../engine/setup";
import { POWER_NAMES, isGone } from "../engine/nations";
import { computerToMove } from "./computerPlay";
import { escape as e, cornersOf, points } from "./mapGeometry";
import { minorDeclareModel, minorDutyMarks, minorPlacementModel } from "./minorView";
import { refreshMinorMarks } from "./mapView";
import type { Session } from "./session";
import { takeAction } from "./sessionActions";

type Draft = { state: GameState; by?: PowerId; minor?: MinorCountry; placements: MinorPlacement[]; chip: number };
const drafts = new WeakMap<Session, Draft>();
function draft(s: Session): Draft {
  let d = drafts.get(s);
  if (!d || d.state !== s.state) {
    d = { state: s.state, placements: [], chip: 0 };
    drafts.set(s, d);
  }
  return d;
}
function placement(s: Session, actions: readonly Action[]) {
  return computerToMove(s) ? null : minorPlacementModel(s.ctx, s.state, s.humanSide, actions, draft(s).placements);
}

/** Spec 15 R1/R2/R4 D1: inspect every minor, confirm only the supplied legal action. */
export function minorHtml(s: Session, actions: readonly Action[]): string {
  const d = draft(s);
  let html = minorDutyMarks(s.state).map((m) => `<p class="minor-duty">${e(m.text)}</p>`).join("");
  const powers = !computerToMove(s) && s.state.position?.part === "player-turn" && s.state.position.step === "1"
    ? Object.values(s.state.nations).filter((n) => sideOfOwner(n.id) === s.humanSide && !isGone(n)).map((n) => n.id) : [];
  if (powers.length) html += `<details class="declarations"><summary>Small countries</summary>${powers.map((by) => `<h3>${POWER_NAMES[by]}</h3>${MINOR_COUNTRIES.map((minor) => {
    const m = minorDeclareModel(s.ctx, s.state, by, minor, actions);
    return `<button data-minor="${minor}" data-by="${by}">${e(m.name)}: ${m.value ?? "No printed value"} BRPs; price ${m.cost} BRPs. ${e(m.summary)} — ${e(m.status)}${m.reason ? `. ${e(m.reason)}` : ""}</button>`;
  }).join("")}`).join("")}</details>`;
  if (d.by && d.minor && powers.includes(d.by)) {
    const m = minorDeclareModel(s.ctx, s.state, d.by, d.minor, actions);
    html += `<section class="minor-card" aria-labelledby="minor-title"><h2 id="minor-title" tabindex="-1">${e(m.name)}</h2><p>${e(m.text)}</p>${m.reason ? `<p>${e(m.reason)}</p>` : ""}<button id="minor-declare"${m.buttons[0]!.disabled ? " disabled" : ""}>Declare war</button><button id="minor-cancel">Cancel</button></section>`;
  }
  const m = placement(s, actions);
  if (m) html += `<section class="minor-card" aria-labelledby="minor-place-title"><h2 id="minor-place-title" tabindex="-1">${e(m.title)}</h2><p>${e(m.hint)}</p><button id="minor-auto">Place automatically</button><ul class="chips">${m.chips.map((c) => `<li><button data-minor-chip="${c.index}" aria-pressed="${d.chip === c.index}">${c.strength}${c.movement ? `-${c.movement}` : ""} ${e(c.type)}: ${e(c.at ?? "Choose a hex")}</button></li>`).join("")}</ul><p>Tap a counter, then a yellow hex, or choose here.</p><div class="minor-hexes">${(m.chips[d.chip]?.hexes ?? []).map((h) => `<button data-minor-hex="${e(h)}">${e(s.ctx.map.hexes[h]?.name ?? h)} (${e(h)})</button>`).join("")}</div>${m.problem ? `<p role="status">${e(m.problem)}</p>` : ""}<button id="minor-done"${m.buttons[1]!.disabled ? " disabled" : ""}>Done</button></section>`;
  return html;
}

/** Spec 15 R3/R9 D2/D5: automatic placement fills an editable draft; only Done submits it. */
export function minorAuto(s: Session, actions: readonly Action[]): void {
  const m = placement(s, actions);
  if (m) draft(s).placements = m.buttons[0]!.action!.placements.map((p) => ({ ...p }));
}
export function minorTap(s: Session, hex: string): boolean {
  if (computerToMove(s) || s.state.position?.part !== "player-turn" || s.state.position.step !== "2") return false;
  const m = placement(s, legalActions(s.ctx, s.state));
  if (!m) return false;
  const d = draft(s), c = m.chips[d.chip];
  if (c?.hexes.includes(hex)) {
    // Spec 15 R3: keep chip order, including unplaced chips, for the model's atomic validation.
    d.placements[d.chip] = { type: c.type, strength: c.strength, at: hex };
    s.toast = "";
  } else s.toast = "Choose a yellow hex for this counter.";
  return true;
}

/** Spec 15 R2/R3: re-read models at confirmation; all game changes use the normal action path. */
export function bindMinor(root: HTMLElement, s: Session, actions: readonly Action[], redraw: () => void): void {
  refreshMinorMarks(root.ownerDocument, s.ctx, s.state);
  const m = placement(s, actions), d = draft(s);
  const layer = root.ownerDocument.querySelector("g.minor-placement");
  if (layer) layer.innerHTML = (m?.chips[d.chip]?.hexes ?? []).map((h) => `<polygon points="${points(cornersOf(h))}"/>`).join("");
  const on = (selector: string, f: (b: HTMLElement) => void) => root.querySelectorAll<HTMLElement>(selector).forEach((b) => b.addEventListener("click", () => { f(b); redraw(); }));
  on("[data-minor]", (b) => { d.by = b.dataset.by as PowerId; d.minor = b.dataset.minor as MinorCountry; });
  on("#minor-cancel", () => { delete d.minor; delete d.by; });
  on("#minor-declare", () => {
    if (!d.by || !d.minor) return;
    const a = minorDeclareModel(s.ctx, s.state, d.by, d.minor, actions).buttons[0]!.action;
    if (a) takeAction(s, a);
  });
  on("#minor-auto", () => minorAuto(s, actions));
  on("[data-minor-chip]", (b) => { d.chip = Number(b.dataset.minorChip); });
  on("[data-minor-hex]", (b) => { minorTap(s, b.dataset.minorHex!); });
  on("#minor-done", () => { const a = placement(s, actions)?.buttons[1]!.action; if (a) takeAction(s, a); });
}
