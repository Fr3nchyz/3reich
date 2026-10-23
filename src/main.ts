import "./style.css";
import "./attack.css";
import "./move.css";
import "./end.css";
import { MAP } from "./data/map";
import { SCENARIO_1939 } from "./data/scenario-1939";
import { SCENARIO_1942 } from "./data/scenario-1942";
import { SCENARIO_1944 } from "./data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "./data/scenario-campaign";
import { legalActions } from "./engine/actions";
import { setupStatus } from "./engine/requirements";
import type { Scenario, Side } from "./engine/types";
import { describeHex, describeUnits } from "./ui/format";
import type { MapHex } from "./engine/map";
import { renderMap } from "./ui/mapView";
import { syncMap } from "./ui/mapSync";
import { createComputerLoop } from "./ui/computerLoop";
import { computerToMove } from "./ui/computerPlay";
import { createSession, setupView, type Session } from "./ui/session";
import { normaliseMode, tapHex } from "./ui/sessionActions";
import { captureFocus, restoreFocus } from "./ui/focusKeep";
import { captureLog, restoreLog } from "./ui/logView";
import { bindOverlay } from "./ui/overlayToggle";
import { bindZoom, canChooseStack, lookedHex, nothingSelectedText } from "./ui/zoomControls";
import { mountShell } from "./ui/shell";
import { bindStatus } from "./ui/statusBind";
import { bindBar, bindPanel, drawBar, keepPanel } from "./ui/watchBar";
import { createWatchLoop } from "./ui/watchLoop";
import { newWatchSession, takeOver } from "./ui/watchPlay";
import { watchMenu } from "./ui/watchMenu";
import { revealCard } from "./ui/hexCardView";
import { revealFresh, revealStep } from "./ui/reveal";
import { revealMove, revealMoveStep } from "./ui/moveView";
import { revealAir } from "./ui/airCardView";
import { revealAirMove } from "./ui/airMoveView";
import { bindMoveEscape } from "./ui/moveBind";
import { atStep6f } from "./ui/moveTap";
import { attacking } from "./ui/attackTap";
import { unseenChoice } from "./ui/choiceTap";
import { announceAttack } from "./ui/attackAnnounce";
import { installE2eLoad } from "./ui/e2eLoad";
import { statusHtml } from "./ui/statusView";
import { bindEnd, revealEnd, revealSurrender, revealWinter, syncObjectives } from "./ui/endBind";

const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];

/** The one game being played; start() replaces it. */
let session: Session;
/** Whether the player was at step 7h with attacks to make at the last draw: the panel scrolls to the list when it begins (spec 07, part D). */
let wasAttacking = false;
/** Whether it was the player's step 6f at the last draw: the Next bar and the list of stacks are brought into view when it begins. */
let wasMoving = false;

/** The hex info line: the hex, and the counters in it now (the map is redrawn after every action, which also fires a hover, so both use this). */
const hexText = (h: MapHex): string => [describeHex(h), describeUnits(session.state, h.id)].filter(Boolean).join(" \u00b7 ");

const computer = createComputerLoop(() => session, () => render());
const watcher = createWatchLoop(() => session, () => render());
const shell = mountShell(document.getElementById("app")!);
const view = renderMap(shell.map, MAP, {
  onHover: (h) => { if (h) shell.info.textContent = hexText(h); },
  onHexClick: (h) => { shell.info.textContent = hexText(h); tapHex(session, h); render(); if (!session.moveChosen) revealCard(shell.status); },
});
shell.fronts.addEventListener("change", (e) => view.setFronts((e.target as HTMLInputElement).checked));
shell.wholeMap.addEventListener("click", () => view.focus([]));
bindZoom(shell, view, () => lookedHex(session), undefined, undefined, () => nothingSelectedText(session), () => canChooseStack(session));
const overlay = bindOverlay(shell, view, () => session);
bindMoveEscape(document, () => session, () => render());

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
  const options = menu.read();
  if (!options) return; // the menu shows what is wrong with the seed or the number of Game Turns
  menu.collapse();
  begin(scenario, newWatchSession(scenario, options.seed, options.speed, options.turns));
  // On a phone the menu above the map is tall: bring the map and the controls into view (a no-op in the two-column layout).
  window.scrollTo(0, document.querySelector("header")!.offsetHeight);
}

/** "Stop watching": back to the setup menu with a fresh single-player game (spec 06); focus goes to the Mode menu, where a new game is chosen. */
function stopWatching(): void {
  start(session.ctx.scenario, "axis");
  shell.side.focus();
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
  const watchPanel = shell.status.querySelector<HTMLElement>(".watch-panel");
  shell.status.innerHTML = statusHtml(session, setup, actions);
  keepPanel(shell.status, watchPanel);
  restoreLog(shell.status, mark);
  restoreFocus(shell.status, focus);
  syncMap(view, session, setup, actions);
  syncObjectives(view, session);
  overlay.refresh(session);
  shell.mapToast.textContent = session.toast;
  bindStatus(shell.status, session, setup, actions, render);
  drawBar(shell.watchBar, session);
  bindPanel(shell.status, session, { stop: stopWatching, takeOver: takeOverAs });
  bindEnd(shell.status, session, render, { newGame: () => shell.newGame.click() });
  revealEnd(shell.status, session);
  revealWinter(shell.status, session);
  revealSurrender(shell.status, session);
  revealFresh(shell.status, session, unseenChoice(session));
  revealMove(shell.status, session);
  revealAir(shell.status, session);
  revealAirMove(shell.status, session);
  announceAttack(shell.live, session);
  const now = attacking(session) && shell.status.querySelector(".attacks") !== null;
  if (now && !wasAttacking) revealStep(shell.status);
  wasAttacking = now;
  const moving = atStep6f(session);
  if (moving && !wasMoving) revealMoveStep(shell.status);
  wasMoving = moving;
  if (session.watch) watcher.kick();
  else computer.kick();
}

// Test-only loader: compiled in only by the e2e build (`vite build --mode e2e`, used by Playwright); the normal build folds this test to false and drops the module.
if (import.meta.env.MODE === "e2e") installE2eLoad(document, location.search, SCENARIOS, (scenario, next) => { shell.side.value = next.humanSide; menu.refresh(); begin(scenario, next); });
start(SCENARIO_1939, "axis");
