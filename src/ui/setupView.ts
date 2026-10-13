import { OWNER_NAMES } from "../engine/nations";
import { placementPlaces } from "../engine/placement";
import { setupProblems } from "../engine/requirements";
import { poolSpecs } from "../engine/setup";
import type { ForceOwner } from "../engine/types";
import { counterLabel } from "./mapStyle";
import { currentSpec, specKey, type PoolSpec, type Session } from "./session";

/** The setup panel: HTML text for the pieces, from the session. The element ids, classes and texts are what the browser test and the player rely on. */

/** The "Place counters" / "Take counters back" switch. */
function modeSwitch(s: Session, placed: number): string {
  return `<div class="chips" role="group" aria-label="What a tap does">
        <button data-mode="place" aria-pressed="${s.mode === "place"}">Place counters</button>
        <button data-mode="remove" aria-pressed="${s.mode === "remove"}" ${placed ? "" : "disabled"}>Take counters back</button>
      </div>`;
}

function hint(s: Session, specs: PoolSpec[]): string {
  if (s.mode === "remove") return "Tap a hex that holds one of your counters to take the top one back.";
  return specs.length ? "Pick a counter, then tap a yellow hex to place it." : "Everything is placed.";
}

/** One chip per kind of counter still in the pool; the chosen one is pressed. */
function counterChips(specs: PoolSpec[], chosen: PoolSpec | null): string {
  const chip = (p: PoolSpec) => `<button data-spec="${specKey(p)}" aria-pressed="${chosen && specKey(p) === specKey(chosen)}">${p.count} &times; ${counterLabel({ type: p.type, strength: p.strength, movement: p.movement })}<br><small>${p.type}${p.nationality ? ` (${p.nationality})` : ""}</small></button>`;
  return `<div class="chips">${specs.map(chip).join("")}</div>`;
}

/** Buttons for the places off the map (the U.S. Box and the like) the chosen counter may go. */
function boxButtons(s: Session, owner: ForceOwner, spec: PoolSpec | null): string {
  const boxes = spec ? placementPlaces(s.ctx, s.state, owner, spec).filter((p) => !s.ctx.map.hexes[p]) : [];
  if (!boxes.length) return "";
  return `<div class="actions">${boxes.map((b) => `<button data-box="${b}">Place in the ${b === "us-box" ? "U.S. Box" : b}</button>`).join("")}</div>`;
}

function actionButtons(owner: ForceOwner, placed: number, problems: number): string {
  return `<div class="actions">
        <button id="undo" ${placed ? "" : "disabled"}>Take back the last one</button>
        <button id="fill">Place the rest for me</button>
        <button id="done" ${problems ? "disabled" : ""}>Done with ${OWNER_NAMES[owner]}</button>
      </div>`;
}

export function setupPanel(s: Session, owner: ForceOwner): string {
  const specs = poolSpecs(s.state, owner);
  const spec = currentSpec(s, owner);
  const problems = setupProblems(s.ctx, s.state, owner);
  const placed = Object.values(s.state.units).filter((u) => u.owner === owner);
  return `
    <div class="setup">
      <h2>Your setup: ${OWNER_NAMES[owner]} &mdash; ${s.state.setup!.index + 1} of ${s.state.setup!.order.length}</h2>
      ${modeSwitch(s, placed.length)}
      <p>${hint(s, specs)}</p>
      ${counterChips(specs, spec)}
      ${boxButtons(s, owner, spec)}
      <p>On the map: ${placed.length}</p>
      <ul class="problems">${problems.map((p) => `<li>${p}</li>`).join("")}</ul>
      ${actionButtons(owner, placed.length, problems.length)}
      <p class="note">The "rest for me" placement is legal under the rules but not a sensible opening.</p>
    </div>`;
}
