import "./style.css";
import { MAP } from "./data/map";
import { SCENARIO_1939 } from "./data/scenario-1939";
import { applyAction, legalActions, type Action, type GameEvent } from "./engine/actions";
import { initiativeTotals, newGame } from "./engine/game";
import { POWER_NAMES, spendingLimit } from "./engine/nations";
import type { MapHex } from "./engine/map";
import type { GameState } from "./engine/types";
import { renderMap } from "./ui/mapView";

// The UI owns the only nondeterministic choice: the seed. Everything after it is replayable.
const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
let state: GameState = newGame(SCENARIO_1939, seed);
const log: string[] = [`${SCENARIO_1939.name} started.`];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const app = document.getElementById("app")!;
app.innerHTML = `
  <header>
    <h1>3Reich</h1>
    <label><input type="checkbox" id="fronts"> Show fronts</label>
    <span id="hexinfo" class="hexinfo">Hover a hex</span>
  </header>
  <div id="map" class="map-wrap"></div>
  <section id="status"></section>`;
const statusEl = document.getElementById("status")!;
const info = document.getElementById("hexinfo")!;

const describeHex = (h: MapHex | null) => {
  if (!h) return "";
  const parts = [h.id, h.name, h.land ? cap(h.land) : "Sea", h.land && h.sea ? "coastal" : "", h.country && cap(h.country), `${cap(h.front)} Front`];
  if (h.fortress) parts.push(`fortress (${h.fortress})`);
  if (h.features.length) parts.push(h.features.join(", "));
  return parts.filter(Boolean).join(" · ");
};
const view = renderMap(document.getElementById("map")!, MAP, { onHover: (h) => { if (h) info.textContent = describeHex(h); } });
document.getElementById("fronts")!.addEventListener("change", (e) => view.setFronts((e.target as HTMLInputElement).checked));


function describe(e: GameEvent): string {
  switch (e.type) {
    case "INITIATIVE_DETERMINED":
      return `${cap(e.season)} ${e.year}: ${cap(e.firstSide)} take the initiative (Axis ${e.axis} BRPs, Allies ${e.allies}).`;
    case "PLAYER_TURN_STARTED":
      return `${cap(e.side)} player turn begins.`;
    case "GAME_OVER":
      return `The scenario ends after ${cap(e.season)} ${e.year}.`;
  }
}

function label(a: Action): string {
  switch (a.type) {
    case "END_PLAYER_TURN":
      return `End ${cap(a.side)} turn`;
  }
}

function dispatch(action: Action): void {
  const result = applyAction(state, action);
  if (result.ok) {
    state = result.state;
    log.push(...result.events.map(describe));
  } else {
    log.push(`Not allowed: ${result.error}`);
  }
  render();
}

function render(): void {
  const totals = initiativeTotals(state);
  const actions = legalActions(state);
  const rows = Object.values(state.nations)
    .map(
      (n) => `<tr><td>${POWER_NAMES[n.id]}</td><td>${cap(n.status)}</td><td>${n.brpTotal}</td>
        <td>${spendingLimit(n)}</td><td>${n.growthRate}%</td></tr>`,
    )
    .join("");
  const status =
    state.phase === "game-over"
      ? "Game over"
      : `${cap(state.season)} ${state.year} &mdash; ${cap(state.activeSide)} player turn (${cap(state.firstSide)} hold the initiative)`;
  statusEl.innerHTML = `
    <main>
      <p class="turn">${status}</p>
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      <table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>Spend limit</th><th>Growth</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="note">Units are not on the map yet. See docs/ROADMAP.md.</p>
      ${actions.map((a, i) => `<button data-action="${i}">${label(a)}</button>`).join(" ")}
      <ol class="log">${log.map((l) => `<li>${l}</li>`).join("")}</ol>
    </main>`;
  statusEl.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => dispatch(actions[Number(button.dataset.action)]!));
  });
}

render();
