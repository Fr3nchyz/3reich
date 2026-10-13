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
  <div class="map-wrap">
    <div id="map" class="map-fill"></div>
    <div id="hexinfo" class="hexinfo">Tap or hover a hex</div>
  </div>
  <section id="status"></section>`;

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
}

export function mountShell(app: HTMLElement): Shell {
  app.innerHTML = SHELL;
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
  };
}
