import "./style.css";
import { endPlayerTurn, newGame } from "./engine/game";
import { POWER_NAMES, sideBRPs, spendingLimit } from "./engine/nations";
import type { GameState } from "./engine/types";

let state: GameState = newGame();
const app = document.getElementById("app")!;

function render(): void {
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const rows = Object.values(state.nations)
    .map(
      (n) => `<tr><td>${POWER_NAMES[n.id]}</td><td>${cap(n.status)}</td><td>${n.brpTotal}</td>
        <td>${spendingLimit(n)}</td><td>${n.growthRate}%</td></tr>`,
    )
    .join("");
  app.innerHTML = `
    <main>
      <h1>3Reich</h1>
      <p class="turn">${cap(state.season)} ${state.year} &mdash; ${cap(state.activeSide)} player turn
        (${cap(state.firstSide)} hold the initiative)</p>
      <p>Axis BRPs: ${sideBRPs(state.nations, "axis")} &middot; Allied BRPs: ${sideBRPs(state.nations, "allies")}</p>
      <table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>Spend limit</th><th>Growth</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="note">Map and units are not implemented yet. See docs/ROADMAP.md.</p>
      <button id="end">End ${cap(state.activeSide)} turn</button>
      <ol class="log">${state.log.map((l) => `<li>${l}</li>`).join("")}</ol>
    </main>`;
  document.getElementById("end")!.addEventListener("click", () => {
    state = endPlayerTurn(state);
    render();
  });
}

render();
