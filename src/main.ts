import "./style.css";
import { MAP } from "./data/map";
import { SCENARIO_1939 } from "./data/scenario-1939";
import { SCENARIO_1942 } from "./data/scenario-1942";
import { SCENARIO_1944 } from "./data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "./data/scenario-campaign";
import { legalActions } from "./engine/actions";
import { setupStatus } from "./engine/requirements";
import type { Scenario, Side } from "./engine/types";
import { describeHex } from "./ui/format";
import { renderMap } from "./ui/mapView";
import { syncMap } from "./ui/mapSync";
import { createSession, yourSetupOwner, type Session } from "./ui/session";
import { normaliseMode, tapHex } from "./ui/sessionActions";
import { mountShell } from "./ui/shell";
import { bindStatus } from "./ui/statusBind";
import { statusHtml } from "./ui/statusView";

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];

const shell = mountShell(document.getElementById("app")!);
const view = renderMap(shell.map, MAP, {
  onHover: (h) => { if (h) shell.info.textContent = describeHex(h); },
  onHexClick: (h) => { shell.info.textContent = describeHex(h); tapHex(session, h); render(); },
});
shell.fronts.addEventListener("change", (e) => view.setFronts((e.target as HTMLInputElement).checked));
shell.wholeMap.addEventListener("click", () => view.focus([]));

/** The scenarios whose setup can be played now; the others wait for map data the printed card lacks. */
shell.scenario.innerHTML = SCENARIOS.map((s) => {
  const startable = setupStatus({ map: MAP, scenario: s }).startable;
  return `<option value="${s.id}" ${startable ? "" : "disabled"}>${s.name}${startable ? "" : " (not available yet)"}</option>`;
}).join("");
shell.newGame.addEventListener("click", () => start(SCENARIOS.find((s) => s.id === shell.scenario.value)!, shell.side.value as Side));

/** The one game being played; start() replaces it. */
let session: Session;

// The UI owns the only nondeterministic choice: the seed. Everything after it is replayable.
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

function start(scenario: Scenario, side: Side): void {
  session = createSession(scenario, side, newSeed());
  shell.scenario.value = scenario.id;
  shell.side.value = side;
  view.focus([]);
  render();
}

function render(): void {
  normaliseMode(session);
  const mine = yourSetupOwner(session);
  const actions = session.state.phase === "player-turn" ? legalActions(session.ctx, session.state) : [];
  shell.status.innerHTML = statusHtml(session, mine, actions);
  syncMap(view, session, mine);
  bindStatus(shell.status, session, actions, render);
}

start(SCENARIO_1939, "axis");
