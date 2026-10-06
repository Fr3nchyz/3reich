import "./style.css";
import { MAP } from "./data/map";
import { SCENARIO_1939 } from "./data/scenario-1939";
import { SCENARIO_1942 } from "./data/scenario-1942";
import { SCENARIO_1944 } from "./data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "./data/scenario-campaign";
import { applyAction, legalActions, type Action, type GameEvent } from "./engine/actions";
import { autoSetup } from "./engine/autosetup";
import type { GameContext } from "./engine/context";
import { initiativeTotals, newGame } from "./engine/game";
import type { MapHex } from "./engine/map";
import { OWNER_NAMES, POWER_NAMES, spendingLimit } from "./engine/nations";
import { currentSetupOwner, poolSpecs, setupProblems, setupStatus, sideOfOwner } from "./engine/setup";
import type { GameState, Scenario } from "./engine/types";
import { counterLabel, renderMap } from "./ui/mapView";

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const app = document.getElementById("app")!;
app.innerHTML = `
  <header>
    <h1>3Reich</h1>
    <label>Scenario <select id="scenario"></select></label>
    <label><input type="checkbox" id="fronts"> Show fronts</label>
    <span id="hexinfo" class="hexinfo">Hover a hex</span>
  </header>
  <div id="map" class="map-wrap"></div>
  <section id="status"></section>`;
const statusEl = document.getElementById("status")!;
const info = document.getElementById("hexinfo")!;
const select = document.getElementById("scenario") as HTMLSelectElement;

const describeHex = (h: MapHex | null) => {
  if (!h) return "";
  const parts = [h.id, h.name, h.land ? cap(h.land) : "Sea", h.land && h.sea ? "coastal" : "", h.country && cap(h.country), `${cap(h.front)} Front`];
  if (h.fortress) parts.push(`fortress (${h.fortress})`);
  if (h.features.length) parts.push(h.features.join(", "));
  return parts.filter(Boolean).join(" · ");
};
const view = renderMap(document.getElementById("map")!, MAP, { onHover: (h) => { if (h) info.textContent = describeHex(h); } });
document.getElementById("fronts")!.addEventListener("change", (e) => view.setFronts((e.target as HTMLInputElement).checked));

// The UI owns the only nondeterministic choice: the seed. Everything after it is replayable.
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
let ctx: GameContext;
let state: GameState;
let log: string[] = [];

/** The scenarios whose setup can be played now; the others wait for map data the printed card lacks. */
const availability = new Map(SCENARIOS.map((s) => [s.id, setupStatus({ map: MAP, scenario: s })]));
select.innerHTML = SCENARIOS.map((s) => {
  const a = availability.get(s.id)!;
  return `<option value="${s.id}" ${a.startable ? "" : "disabled"}>${s.name}${a.startable ? "" : " (not available yet)"}</option>`;
}).join("");
select.addEventListener("change", () => start(SCENARIOS.find((s) => s.id === select.value)!));

function start(scenario: Scenario): void {
  ctx = { map: MAP, scenario };
  state = newGame(scenario, newSeed());
  log = [`${scenario.name} started. Each nation sets up its forces in turn.`];
  select.value = scenario.id;
  render();
}

function describe(e: GameEvent): string | null {
  switch (e.type) {
    case "UNIT_PLACED":
    case "UNIT_REMOVED":
      return null;
    case "SETUP_OWNER_DONE":
      return `${OWNER_NAMES[e.owner]} has set up.`;
    case "SETUP_COMPLETE":
      return "Setup is complete.";
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
    default:
      return a.type;
  }
}

function dispatch(...actions: Action[]): void {
  for (const action of actions) {
    const result = applyAction(ctx, state, action);
    if (!result.ok) {
      log.push(`Not allowed: ${result.error}`);
      break;
    }
    state = result.state;
    for (const e of result.events) {
      const line = describe(e);
      if (line) log.push(line);
    }
  }
  render();
}

function setupPanel(): string {
  const owner = currentSetupOwner(state)!;
  const specs = poolSpecs(state, owner);
  const problems = setupProblems(ctx, state, owner);
  const placed = Object.values(state.units).filter((u) => u.owner === owner);
  return `
    <div class="setup">
      <h2>Setup: ${OWNER_NAMES[owner]} (${sideOfOwner(owner) === "axis" ? "Axis" : "Allied"} player) &mdash; ${state.setup!.index + 1} of ${state.setup!.order.length}</h2>
      <p>To place:</p>
      <ul>${specs.map((s) => `<li>${s.count} &times; ${counterLabel({ type: s.type, strength: s.strength, movement: s.movement })} ${s.type}${s.nationality ? ` (${cap(s.nationality)})` : ""}</li>`).join("") || "<li>nothing left</li>"}</ul>
      <p>On the map: ${placed.length}</p>
      <ul class="problems">${problems.map((p) => `<li>${p}</li>`).join("")}</ul>
      <button id="autosetup">Set everything up automatically</button>
      <p class="note">Placing counters by hand is not in the app yet. The automatic setup is legal under the rules but not a sensible opening; the same rules will check your own placements.</p>
    </div>`;
}

function render(): void {
  const totals = initiativeTotals(state);
  const actions = state.phase === "setup" ? [] : legalActions(ctx, state);
  const rows = Object.values(state.nations)
    .map(
      (n) => `<tr><td>${POWER_NAMES[n.id]}</td><td>${cap(n.status)}</td><td>${n.brpTotal}</td>
        <td>${spendingLimit(n)}</td><td>${n.growthRate}%</td></tr>`,
    )
    .join("");
  const status =
    state.phase === "game-over"
      ? "Game over"
      : state.phase === "setup"
        ? `${cap(state.season)} ${state.year} &mdash; setting up`
        : `${cap(state.season)} ${state.year} &mdash; ${cap(state.activeSide)} player turn (${cap(state.firstSide)} hold the initiative)`;
  statusEl.innerHTML = `
    <main>
      <p class="turn">${status}</p>
      ${state.phase === "setup" ? setupPanel() : ""}
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      <table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>Spend limit</th><th>Growth</th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${actions.map((a, i) => `<button data-action="${i}">${label(a)}</button>`).join(" ")}
      <ol class="log">${log.map((l) => `<li>${l}</li>`).join("")}</ol>
    </main>`;
  view.setUnits(Object.values(state.units));
  statusEl.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => dispatch(actions[Number(button.dataset.action)]!));
  });
  statusEl.querySelector("#autosetup")?.addEventListener("click", () => dispatch(...autoSetup(ctx, state)));
}

start(SCENARIO_1939);
