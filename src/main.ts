import "./style.css";
import { MAP } from "./data/map";
import { SCENARIO_1939 } from "./data/scenario-1939";
import { SCENARIO_1942 } from "./data/scenario-1942";
import { SCENARIO_1944 } from "./data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "./data/scenario-campaign";
import { applyAction, legalActions, type Action, type GameEvent } from "./engine/actions";
import { autoSetupOwner } from "./engine/autosetup";
import type { GameContext } from "./engine/context";
import { initiativeTotals, newGame } from "./engine/game";
import type { MapHex } from "./engine/map";
import { OWNER_NAMES, POWER_NAMES, spendingLimit } from "./engine/nations";
import { currentSetupOwner, placementPlaces, poolSpecs, setupProblems, setupStatus, sideOfOwner, territoryOf, type UnitSpec } from "./engine/setup";
import type { GameState, OffMapBox, Scenario, Side } from "./engine/types";
import { counterLabel, renderMap } from "./ui/mapView";

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const sideName = (s: Side) => (s === "axis" ? "Axis" : "Allied");
const app = document.getElementById("app")!;
app.innerHTML = `
  <header>
    <h1>3Reich</h1>
    <label>Scenario <select id="scenario"></select></label>
    <label>You play <select id="side"><option value="axis">Axis</option><option value="allies">Allies</option></select></label>
    <button id="newgame">New game</button>
    <label><input type="checkbox" id="fronts"> Show fronts</label>
    <button id="wholemap">Whole map</button>
  </header>
  <div class="map-wrap">
    <div id="map" class="map-fill"></div>
    <div id="hexinfo" class="hexinfo">Tap or hover a hex</div>
  </div>
  <section id="status"></section>`;
const statusEl = document.getElementById("status")!;
const info = document.getElementById("hexinfo")!;
const scenarioSelect = document.getElementById("scenario") as HTMLSelectElement;
const sideSelect = document.getElementById("side") as HTMLSelectElement;

const describeHex = (h: MapHex | null) => {
  if (!h) return "";
  const parts = [h.id, h.name, h.land ? cap(h.land) : "Sea", h.land && h.sea ? "coastal" : "", h.country && cap(h.country), `${cap(h.front)} Front`];
  if (h.fortress) parts.push(`fortress (${h.fortress})`);
  if (h.features.length) parts.push(h.features.join(", "));
  return parts.filter(Boolean).join(" · ");
};
const view = renderMap(document.getElementById("map")!, MAP, {
  onHover: (h) => { if (h) info.textContent = describeHex(h); },
  onHexClick: (h) => { info.textContent = describeHex(h); tapHex(h); },
});
document.getElementById("fronts")!.addEventListener("change", (e) => view.setFronts((e.target as HTMLInputElement).checked));
document.getElementById("wholemap")!.addEventListener("click", () => view.focus([]));

// The UI owns the only nondeterministic choice: the seed. Everything after it is replayable.
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
let ctx: GameContext;
let state: GameState;
let humanSide: Side = "axis";
let log: string[] = [];
let selected: UnitSpec | null = null;
/** What a tap on the map does during your setup: put the chosen counter down, or pick one up. */
let mode: "place" | "remove" = "place";
let toast = "";
/** The nation the map was last zoomed to, so it zooms once per nation and then stays where you put it. */
let focusedOwner: string | null = null;

/** The scenarios whose setup can be played now; the others wait for map data the printed card lacks. */
const availability = new Map(SCENARIOS.map((s) => [s.id, setupStatus({ map: MAP, scenario: s })]));
scenarioSelect.innerHTML = SCENARIOS.map((s) => {
  const a = availability.get(s.id)!;
  return `<option value="${s.id}" ${a.startable ? "" : "disabled"}>${s.name}${a.startable ? "" : " (not available yet)"}</option>`;
}).join("");
document.getElementById("newgame")!.addEventListener("click", () => start(SCENARIOS.find((s) => s.id === scenarioSelect.value)!, sideSelect.value as Side));

function start(scenario: Scenario, side: Side): void {
  ctx = { map: MAP, scenario };
  humanSide = side;
  state = newGame(scenario, newSeed());
  log = [`${scenario.name} started. You play the ${sideName(side)} side; the computer sets up the other.`];
  scenarioSelect.value = scenario.id;
  sideSelect.value = side;
  selected = null;
  mode = "place";
  toast = "";
  focusedOwner = null;
  view.focus([]);
  computerSetup();
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
      return `${sideName(e.side)} player turn begins.`;
    case "GAME_OVER":
      return `The scenario ends after ${cap(e.season)} ${e.year}.`;
  }
}

/** Applies actions in order, logging what happened; stops at the first one the rules refuse. */
function run(...actions: Action[]): boolean {
  for (const action of actions) {
    const result = applyAction(ctx, state, action);
    if (!result.ok) {
      toast = result.error;
      return false;
    }
    state = result.state;
    for (const e of result.events) {
      const line = describe(e);
      if (line) log.push(line);
    }
  }
  return true;
}

/** The computer sets up its nations (a placeholder for its own choices) until a nation of yours is up. */
function computerSetup(): void {
  for (let guard = 0; guard < 20 && state.phase === "setup"; guard++) {
    const owner = currentSetupOwner(state)!;
    if (sideOfOwner(owner) === humanSide) break;
    run(...autoSetupOwner(ctx, state));
  }
}

const specKey = (s: Pick<UnitSpec, "type" | "strength" | "nationality">) => `${s.type}:${s.strength}:${s.nationality ?? ""}`;

/** The counter to place next: the one chosen, or else the first still in the pool. */
function currentSpec(owner: Parameters<typeof poolSpecs>[1]): (UnitSpec & { movement?: number; count: number }) | null {
  const specs = poolSpecs(state, owner);
  return specs.find((s) => selected && specKey(s) === specKey(selected)) ?? specs[0] ?? null;
}

function tapHex(h: MapHex): void {
  toast = "";
  const owner = currentSetupOwner(state);
  if (!owner || sideOfOwner(owner) !== humanSide) return render();
  const mine = Object.values(state.units).filter((u) => u.owner === owner && u.at === h.id);
  if (mode === "remove") {
    const top = mine[mine.length - 1];
    if (top) run({ type: "SETUP_REMOVE", owner, unitId: top.id });
    else toast = "You have no counter there. Tap a hex that shows one of yours.";
    return render();
  }
  const spec = currentSpec(owner);
  const places = spec ? new Set(placementPlaces(ctx, state, owner, spec)) : new Set<string>();
  if (spec && places.has(h.id)) {
    run({ type: "SETUP_PLACE", owner, unit: { type: spec.type, strength: spec.strength, ...(spec.nationality ? { nationality: spec.nationality } : {}) }, at: h.id });
  } else {
    toast = spec ? `A ${spec.strength}-factor ${spec.type} cannot go there. The yellow hexes are the places it can.` : "Nothing left to place.";
  }
  render();
}

function setupPanel(owner: ReturnType<typeof currentSetupOwner> & string): string {
  const specs = poolSpecs(state, owner);
  const spec = currentSpec(owner);
  const problems = setupProblems(ctx, state, owner);
  const placed = Object.values(state.units).filter((u) => u.owner === owner);
  const boxes = spec ? placementPlaces(ctx, state, owner, spec).filter((p) => !MAP.hexes[p]) : [];
  return `
    <div class="setup">
      <h2>Your setup: ${OWNER_NAMES[owner]} &mdash; ${state.setup!.index + 1} of ${state.setup!.order.length}</h2>
      <div class="chips" role="group" aria-label="What a tap does">
        <button data-mode="place" aria-pressed="${mode === "place"}">Place counters</button>
        <button data-mode="remove" aria-pressed="${mode === "remove"}" ${placed.length ? "" : "disabled"}>Take counters back</button>
      </div>
      <p>${mode === "remove" ? "Tap a hex that holds one of your counters to take the top one back." : specs.length ? "Pick a counter, then tap a yellow hex to place it." : "Everything is placed."}</p>
      <div class="chips">${specs
        .map((s) => `<button data-spec="${specKey(s)}" aria-pressed="${spec && specKey(s) === specKey(spec)}">${s.count} &times; ${counterLabel({ type: s.type, strength: s.strength, movement: s.movement })}<br><small>${s.type}${s.nationality ? ` (${s.nationality})` : ""}</small></button>`)
        .join("")}</div>
      ${boxes.length ? `<div class="actions">${boxes.map((b) => `<button data-box="${b}">Place in the ${b === "us-box" ? "U.S. Box" : b}</button>`).join("")}</div>` : ""}
      <p>On the map: ${placed.length}</p>
      <ul class="problems">${problems.map((p) => `<li>${p}</li>`).join("")}</ul>
      <div class="actions">
        <button id="undo" ${placed.length ? "" : "disabled"}>Take back the last one</button>
        <button id="fill">Place the rest for me</button>
        <button id="done" ${problems.length ? "disabled" : ""}>Done with ${OWNER_NAMES[owner]}</button>
      </div>
      <p class="note">The "rest for me" placement is legal under the rules but not a sensible opening.</p>
    </div>`;
}

function render(): void {
  const totals = initiativeTotals(state);
  const owner = currentSetupOwner(state);
  // With nothing of yours on the map there is nothing to take back.
  if (mode === "remove" && !Object.values(state.units).some((u) => u.owner === owner)) mode = "place";
  const mySetup = owner !== null && sideOfOwner(owner) === humanSide;
  const actions = state.phase === "player-turn" ? legalActions(ctx, state) : [];
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
        : `${cap(state.season)} ${state.year} &mdash; ${sideName(state.activeSide)} player turn (${cap(state.firstSide)} hold the initiative)`;
  statusEl.innerHTML = `
    <main>
      <p class="turn">${status}</p>
      ${mySetup ? setupPanel(owner) : ""}
      <p class="toast" role="status">${toast}</p>
      ${state.phase === "player-turn" ? `<p class="note">The computer opponent does not play yet, so you take both sides' turns for now.</p>` : ""}
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      <table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>Spend limit</th><th>Growth</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="actions controls">${actions.map((a, i) => `<button data-action="${i}">${a.type === "END_PLAYER_TURN" ? `End ${sideName(a.side)} turn` : a.type}</button>`).join("")}</div>
      <ol class="log">${log.map((l) => `<li>${l}</li>`).join("")}</ol>
    </main>`;
  view.setUnits(Object.values(state.units));
  if (mySetup && owner && focusedOwner !== owner) {
    focusedOwner = owner;
    view.focus(territoryOf(ctx, owner).places);
  } else if (!mySetup && focusedOwner !== null) {
    focusedOwner = null;
    view.focus([]);
  }
  const spec = mySetup && owner ? currentSpec(owner) : null;
  const ownHexes = owner ? Object.values(state.units).filter((u) => u.owner === owner && MAP.hexes[u.at]).map((u) => u.at) : [];
  view.setHighlights(!mySetup || !owner ? [] : mode === "remove" ? ownHexes : spec ? placementPlaces(ctx, state, owner, spec).filter((p) => MAP.hexes[p]) : []);

  statusEl.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((b) => b.addEventListener("click", () => { toast = ""; run(actions[Number(b.dataset.action)]!); render(); }));
  statusEl.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((b) => b.addEventListener("click", () => {
    mode = b.dataset.mode as typeof mode;
    toast = "";
    render();
  }));
  statusEl.querySelectorAll<HTMLButtonElement>("button[data-spec]").forEach((b) => b.addEventListener("click", () => {
    const [type, strength, nationality] = b.dataset.spec!.split(":");
    selected = { type: type as UnitSpec["type"], strength: Number(strength), ...(nationality ? { nationality: nationality as UnitSpec["nationality"] } : {}) };
    mode = "place";
    toast = "";
    render();
  }));
  statusEl.querySelectorAll<HTMLButtonElement>("button[data-box]").forEach((b) => b.addEventListener("click", () => {
    if (owner && spec) run({ type: "SETUP_PLACE", owner, unit: { type: spec.type, strength: spec.strength }, at: b.dataset.box as OffMapBox });
    render();
  }));
  statusEl.querySelector("#undo")?.addEventListener("click", () => {
    const mine = Object.values(state.units).filter((u) => u.owner === owner);
    const last = mine[mine.length - 1];
    toast = "";
    if (owner && last) run({ type: "SETUP_REMOVE", owner, unitId: last.id });
    render();
  });
  statusEl.querySelector("#fill")?.addEventListener("click", () => {
    toast = "";
    run(...autoSetupOwner(ctx, state));
    selected = null;
    mode = "place";
    computerSetup();
    render();
  });
  statusEl.querySelector("#done")?.addEventListener("click", () => {
    toast = "";
    if (owner && run({ type: "SETUP_DONE", owner })) {
      selected = null;
      mode = "place";
      computerSetup();
    }
    render();
  });
}

start(SCENARIO_1939, "axis");
