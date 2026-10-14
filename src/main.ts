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
import { createComputerLoop } from "./ui/computerLoop";
import { computerToMove } from "./ui/computerPlay";
import { createSession, setupView, type Session } from "./ui/session";
import { normaliseMode, tapHex } from "./ui/sessionActions";
import { captureFocus, restoreFocus } from "./ui/focusKeep";
import { captureLog, restoreLog } from "./ui/logView";
import { bindOverlay } from "./ui/overlayToggle";
import { mountShell } from "./ui/shell";
import { bindStatus } from "./ui/statusBind";
import { bindBar, bindPanel, drawBar } from "./ui/watchBar";
import { createWatchLoop } from "./ui/watchLoop";
import { newWatchSession, takeOver } from "./ui/watchPlay";
import { watchMenu } from "./ui/watchMenu";
import { statusHtml } from "./ui/statusView";

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];

/** The one game being played; start() replaces it. */
let session: Session;

const computer = createComputerLoop(() => session, () => render());
const watcher = createWatchLoop(() => session, () => render());
const shell = mountShell(document.getElementById("app")!);
const view = renderMap(shell.map, MAP, {
  onHover: (h) => { if (h) shell.info.textContent = describeHex(h); },
  onHexClick: (h) => { shell.info.textContent = describeHex(h); tapHex(session, h); render(); },
});
shell.fronts.addEventListener("change", (e) => view.setFronts((e.target as HTMLInputElement).checked));
shell.wholeMap.addEventListener("click", () => view.focus([]));
const overlay = bindOverlay(shell, view, () => session);

/** The scenarios whose setup can be played now; the others wait for map data the printed card lacks. */
shell.scenario.innerHTML = SCENARIOS.map((s) => {
  const startable = setupStatus({ map: MAP, scenario: s }).startable;
  return `<option value="${s.id}" ${startable ? "" : "disabled"}>${s.name}${startable ? "" : " (not available yet)"}</option>`;
}).join("");
shell.newGame.addEventListener("click", () => {
  const scenario = SCENARIOS.find((s) => s.id === shell.scenario.value)!;
  if (shell.side.value === "watch") startWatch(scenario);
  else start(scenario, shell.side.value as Side);
});
bindBar(shell.watchBar, () => session, () => { watcher.reset(); render(); });

// The UI owns the only nondeterministic choice: the seed. Everything after it is replayable.
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
const menu = watchMenu(shell, newSeed);

function begin(scenario: Scenario, next: Session): void {
  computer.reset();
  watcher.reset();
  session = next;
  shell.scenario.value = scenario.id;
  view.focus([]);
  shell.status.innerHTML = ""; // a new game starts its status column and log at the top
  render();
}

function start(scenario: Scenario, side: Side): void {
  shell.side.value = side;
  menu.refresh();
  begin(scenario, createSession(scenario, side, newSeed()));
}

/** Two computers play and the player looks on (spec 06): the seed and the number of Game Turns come from the menu. */
function startWatch(scenario: Scenario): void {
  const { seed, turns, speed } = menu.read();
  begin(scenario, newWatchSession(scenario, seed, speed, turns));
}

/** "Take over as ...": the running watched game becomes a normal one, from where it stands. */
function takeOverAs(side: Side): void {
  watcher.reset();
  takeOver(session, side);
  shell.side.value = side;
  menu.refresh();
  render();
}

function render(): void {
  normaliseMode(session);
  const setup = setupView(session);
  const actions = session.state.phase === "player-turn" && !computerToMove(session) ? legalActions(session.ctx, session.state) : [];
  const mark = captureLog(shell.status);
  const focus = captureFocus(shell.status);
  shell.status.innerHTML = statusHtml(session, setup, actions);
  restoreLog(shell.status, mark);
  restoreFocus(shell.status, focus);
  syncMap(view, session, setup);
  overlay.refresh(session);
  shell.mapToast.textContent = session.toast;
  bindStatus(shell.status, session, setup, actions, render);
  drawBar(shell.watchBar, session);
  bindPanel(shell.status, session, { stop: () => start(session.ctx.scenario, "axis"), takeOver: takeOverAs });
  if (session.watch) watcher.kick();
  else computer.kick();
}

start(SCENARIO_1939, "axis");
