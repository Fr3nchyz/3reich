/** The page around the game: header controls, the map, the hex info overlay and the status area. */

const SHELL = `
  <header>
    <h1>3Reich</h1>
    <label>Scenario <select id="scenario"></select></label>
    <label>Mode <select id="side"><option value="axis">Play Axis</option><option value="allies">Play Allies</option><option value="watch">Watch the computer play both sides</option></select></label>
    <div id="watchopts" class="watch-opts" hidden>
      <span class="watch-help">Two computers play a whole game while you look on: you can pause it, speed it up, step through it and save it.</span>
      <label>Seed <input id="seed" inputmode="numeric" autocomplete="off" aria-describedby="seedhelp"></label>
      <button id="seedrandom" type="button">Random seed</button>
      <label>Stop after <input id="watchturns" type="number" min="1" max="99" placeholder="end" class="watch-turns"> Game Turns</label>
      <span id="seedhelp" class="watch-help">The same scenario and seed play the same game again.</span>
    </div>
    <button id="newgame">New game</button>
    <label><input type="checkbox" id="fronts"> Show fronts</label>
    <button id="wholemap">Whole map</button>
  </header>
  <div class="map-dock">
    <div class="map-wrap">
      <div id="map" class="map-fill"></div>
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
      <p id="w-status" class="watch-status" role="status" aria-live="off"></p>
    </div>
  </div>
  <section id="status" tabindex="-1"></section>`;

export interface Shell {
  map: HTMLElement;
  /** The hex info overlay, inside the map so that changing its text can never shift the layout. */
  info: HTMLElement;
  status: HTMLElement;
  scenario: HTMLSelectElement;
  side: HTMLSelectElement;
  newGame: HTMLElement;
  fronts: HTMLInputElement;
  wholeMap: HTMLElement;
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
    scenario: el<HTMLSelectElement>("scenario"),
    side: el<HTMLSelectElement>("side"),
    newGame: el("newgame"),
    fronts: el<HTMLInputElement>("fronts"),
    wholeMap: el("wholemap"),
    overlay: el<HTMLButtonElement>("overlay"),
    legend: el("legend"),
    mapToast: el("maptoast"),
    watchOpts: el("watchopts"),
    seed: el<HTMLInputElement>("seed"),
    seedRandom: el("seedrandom"),
    watchTurns: el<HTMLInputElement>("watchturns"),
    watchBar: el("watchbar"),
  };
}
