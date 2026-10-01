import "./style.css";
import { endPowerTurn, newGame, POWER_NAMES } from "./engine/game";
import type { GameState } from "./engine/types";

let state: GameState = newGame();
const app = document.getElementById("app")!;

function render(): void {
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  app.innerHTML = `
    <main>
      <h1>3Reich</h1>
      <p class="turn">${cap(state.season)} ${state.year} &mdash; ${POWER_NAMES[state.activePower]} to move</p>
      <p class="note">Map and units are not implemented yet. See docs/ROADMAP.md.</p>
      <button id="end">End ${POWER_NAMES[state.activePower]} turn</button>
      <ol class="log">${state.log.map((l) => `<li>${l}</li>`).join("")}</ol>
    </main>`;
  document.getElementById("end")!.addEventListener("click", () => {
    state = endPowerTurn(state);
    render();
  });
}

render();
