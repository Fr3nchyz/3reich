/** The page around the game: header controls, the map, the hex info overlay and the status area. */

const SHELL = `
  <header>
    <h1>3Reich</h1>
    <label>Scenario <select id="scenario"></select></label>
    <label>You play <select id="side"><option value="axis">Axis</option><option value="allies">Allies</option></select></label>
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
  };
}
