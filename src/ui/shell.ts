import { continueCard, openingText } from "./continueCard";
import type { createSavedGames, SavedGameRow } from "./savedGames";
import { ZOOM_BUTTONS } from "./zoomControls";

/** The page around the game: header controls, the map, the zoom buttons, the hex info overlay and the status area. */

const SHELL = `
  <header>
    <h1>3Reich</h1>
    <label>Scenario <select id="scenario"></select></label>
    <label>Mode <select id="side"><option value="axis">Play Axis</option><option value="allies">Play Allies</option><option value="watch">Watch the computer play both sides</option></select></label>
    <div id="watchopts" class="watch-opts" hidden>
      <span class="watch-help">Two computers play a whole game while you look on: you can pause it, speed it up, step through it and save it.</span>
      <label>Seed <input id="seed" inputmode="numeric" autocomplete="off" aria-describedby="seedhelp menuerror"></label>
      <button id="seedrandom" type="button">Random seed</button>
      <label>Stop after <input id="watchturns" inputmode="numeric" autocomplete="off" placeholder="end" class="watch-turns" aria-describedby="menuerror"> Game Turns</label>
      <span id="seedhelp" class="watch-help">The same scenario and seed play the same game again.</span>
      <span id="menuerror" class="watch-error" role="alert"></span>
    </div>
    <button id="newgame">New game</button>
    <button id="savedgames">Saved games</button>
    <p id="save-notice" role="status"></p>
    <label><input type="checkbox" id="fronts"> Show fronts</label>
    <button id="wholemap">Whole map</button>
  </header>
  <div class="map-dock">
    <div class="map-wrap">
      <div id="map" class="map-fill"></div>
      <div id="zoom" class="zoom" role="group" aria-label="Map zoom">${ZOOM_BUTTONS}</div>
      <p id="zoomsay" class="sr-only" role="status" aria-live="polite"></p>
      <p id="zoomnote" class="zoom-note" aria-hidden="true"></p>
      <div id="hexinfo" class="hexinfo">Tap or hover a hex</div>
      <div id="legend" class="legend" role="note" hidden></div>
      <div id="maptoast" class="map-toast" aria-hidden="true"></div>
    </div>
    <div class="map-tools"><button id="overlay" aria-pressed="false" aria-controls="legend">Control and zones</button></div>
    <div id="watchbar" class="watchbar" role="group" aria-label="Watch controls" hidden>
      <div class="watch-row">
        <button id="w-play" type="button">Pause</button>
        <button id="w-step" type="button">Step one action</button>
        <button id="w-turn" type="button">Step to next turn</button>
        <label>Speed <select id="w-speed"></select></label>
      </div>
      <p id="w-status" class="watch-status"></p>
      <p id="w-announce" class="sr-only" role="status" aria-live="polite"></p>
    </div>
  </div>
  <dialog id="saved-sheet" aria-labelledby="saved-title"><h2 id="saved-title">Saved games</h2><button id="saved-close">Close</button><div id="saved-content"></div><p>Your browser may delete saved games. A file saved outside the browser is the safety net.</p></dialog>
  <div id="status-column"><section id="continue-game" hidden aria-label="Continue your game"></section>

  <section id="status" tabindex="-1"></section></div>
  <p id="a11y-live" class="sr-only" role="status" aria-live="polite"></p>`;

export interface Shell {
  map: HTMLElement;
  /** The hex info overlay, inside the map so that changing its text can never shift the layout. */
  info: HTMLElement;
  status: HTMLElement;
  /** A polite live line for screen readers, outside the redrawn status area (the attack card's odds, spec 07 part D). */
  live: HTMLElement;
  scenario: HTMLSelectElement;
  side: HTMLSelectElement;
  newGame: HTMLElement;
  fronts: HTMLInputElement;
  wholeMap: HTMLElement;
  /** The zoom buttons over the map (see zoomControls.ts), and the line that tells a screen reader what a press did. */
  zoom: HTMLElement;
  zoomSay: HTMLElement;
  /** The same line shown on the map for a few seconds when the target button has nothing to zoom to (aria-hidden: zoomSay is the one read aloud). */
  zoomNote: HTMLElement;
  /** The button that switches the control overlay on and off, and the key shown over the map while it is on. */
  overlay: HTMLButtonElement;
  legend: HTMLElement;
  /** A copy of the rejected-move message over the map, for screens where the status panels are scrolled out of sight (the panel's own line is the one read aloud). */
  mapToast: HTMLElement;
  /** The watch-mode pieces (spec 06): the options in the header, and the control bar under the map. */
  watchOpts: HTMLElement;
  seed: HTMLInputElement;
  seedRandom: HTMLElement;
  watchTurns: HTMLInputElement;
  menuError: HTMLElement;
  watchBar: HTMLElement;
}

/** Publishes the height of the sticky map block as --dock-h, so that scroll-padding-top keeps a focused control from landing behind it. */
function keepDockHeight(dock: HTMLElement): void {
  const set = () => document.documentElement.style.setProperty("--dock-h", `${Math.ceil(dock.getBoundingClientRect().height) + 8}px`);
  set();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(set).observe(dock);
}

export function mountShell(app: HTMLElement): Shell {
  app.innerHTML = SHELL;
  keepDockHeight(app.querySelector<HTMLElement>(".map-dock")!);
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  return {
    map: el("map"),
    info: el("hexinfo"),
    status: el("status"),
    live: el("a11y-live"),
    scenario: el<HTMLSelectElement>("scenario"),
    side: el<HTMLSelectElement>("side"),
    newGame: el("newgame"),
    fronts: el<HTMLInputElement>("fronts"),
    wholeMap: el("wholemap"),
    zoom: el("zoom"),
    zoomSay: el("zoomsay"),
    zoomNote: el("zoomnote"),
    overlay: el<HTMLButtonElement>("overlay"),
    legend: el("legend"),
    mapToast: el("maptoast"),
    watchOpts: el("watchopts"),
    seed: el<HTMLInputElement>("seed"),
    seedRandom: el("seedrandom"),
    watchTurns: el<HTMLInputElement>("watchturns"),
    menuError: el("menuerror"),
    watchBar: el("watchbar"),
  };
}


/** Spec 11 E sketches 2/3/5/6: thin binding; all saved text is inserted as text. */
export function bindSavedGames(shell: Shell, games: ReturnType<typeof createSavedGames>, fresh: () => void) {
  const card = document.getElementById("continue-game")!;
  const sheet = document.getElementById("saved-sheet") as HTMLDialogElement;
  const content = document.getElementById("saved-content")!;
  const trigger = document.getElementById("savedgames")!;
  let returnTo: HTMLElement = trigger;
  let serial = 0;
  let rows: SavedGameRow[] = [];
  const say = (text: string): void => { shell.live.textContent = text; };
  const text = (parent: HTMLElement, value: string, tag = "p"): HTMLElement => {
    const el = document.createElement(tag); el.textContent = value; parent.append(el); return el;
  };
  const button = (parent: HTMLElement, label: string, action: () => void): HTMLButtonElement => {
    const el = document.createElement("button"); el.type = "button"; el.textContent = label;
    el.addEventListener("click", action); parent.append(el); return el;
  };
  const close = (): void => {
    serial++; games.cancel(); sheet.close();
    (returnTo.isConnected && !returnTo.closest("[hidden]") ? returnTo : trigger).focus();
  };
  const show = (): void => {
    if (!sheet.open) { returnTo = document.activeElement as HTMLElement; sheet.showModal(); }
    document.getElementById("saved-close")!.focus();
  };
  const list = async (): Promise<void> => {
    const token = ++serial;
    content.replaceChildren();
    try {
      rows = await games.list();
      if (token !== serial) return;
      if (!rows.length) text(content, "No saved games yet.");
      for (const row of rows) {
        const section = document.createElement("section"); content.append(section);
        text(section, row.title, "h3"); text(section, row.detail);
        if (row.problem) text(section, row.problem);
        if (row.save) button(section, "Open", () => { void open(row.id); });
        button(section, "Delete", () => {
          section.replaceChildren(); text(section, `Delete '${row.title}'?`);
          button(section, "Delete", () => { void (async () => {
            try {
              if (await games.delete(row.id, true)) { say("Saved game deleted."); await list(); document.getElementById("saved-close")!.focus(); }
              else say("Could not delete this saved game.");
            } catch { say("Could not delete this saved game."); }
          })(); });
          button(section, "Cancel", () => { void list(); document.getElementById("saved-close")!.focus(); }).focus();
        });
      }
    } catch (error) { if (token === serial) { text(content, error instanceof Error ? error.message : "Saved games could not be read."); say("Saved games could not be read."); } }
  };
  const opened = (): void => {
    card.hidden = true; sheet.close();
    const heading = shell.status.querySelector<HTMLElement>("h2, h3") ?? shell.status;
    heading.tabIndex = -1; heading.focus(); say("Game opened.");
  };
  const open = async (id: string): Promise<void> => {
    show();
    const token = ++serial;
    content.replaceChildren();
    const progress = text(content, "Opening your game..."); progress.setAttribute("role", "status");
    button(content, "Cancel", () => { games.cancel(); void list(); document.getElementById("saved-close")!.focus(); }).focus();
    const result = await games.open(id, (done, total) => { if (token === serial) progress.textContent = openingText(done, total); });
    if (token !== serial) return;
    if (result.kind === "opened") { opened(); return; }
    content.replaceChildren();
    if (result.kind === "rescue") {
      text(content, "This game was saved by an older version", "h3");
      text(content, result.message);
      text(content, "Later turns may go differently from what you expected.");
      button(content, "Continue from here", () => { if (games.acceptRescue()) opened(); }).focus();
      button(content, "Keep the file", () => { games.keep(); void list(); document.getElementById("saved-close")!.focus(); });
      button(content, "Cancel", () => { games.cancel(); void list(); document.getElementById("saved-close")!.focus(); });
    } else {
      text(content, result.message); say(`Could not open this game. ${result.message}`);
      button(content, "Back to saved games", () => { void list(); }).focus();
    }
  };
  trigger.addEventListener("click", () => { show(); void list(); });
  document.getElementById("saved-close")!.addEventListener("click", close);
  sheet.addEventListener("cancel", event => { event.preventDefault(); close(); });
  // Spec 11 E: a new game stays one tap away and dismisses the startup offer.
  shell.newGame.addEventListener("click", () => { serial++; games.cancel(); card.hidden = true; });
  return {
    init: async (): Promise<void> => {
      const token = serial;
      try {
        rows = await games.list();
        if (token !== serial) return;
        const row = continueCard(rows);
        if (!row) return;
        card.hidden = false;
        text(card, "Continue your game?", "h2"); text(card, row.detail);
        button(card, "Continue", () => { void open(row.id); });
        button(card, "Start a new game", () => { card.hidden = true; fresh(); shell.status.focus(); });
        button(card, "Saved games", () => { show(); void list(); });
      } catch { say("Saved games could not be read. Play can continue."); }
    },
  };
}
