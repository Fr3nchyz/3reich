import "./style.css";
import { SCENARIO_1939 } from "./data/scenario-1939";
import { applyAction, legalActions, type Action, type GameEvent } from "./engine/actions";
import { initiativeTotals, newGame } from "./engine/game";
import { POWER_NAMES, spendingLimit } from "./engine/nations";
import type { GameState } from "./engine/types";

// The UI owns the only nondeterministic choice: the seed. Everything after it is replayable.
const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
let state: GameState = newGame(SCENARIO_1939, seed);
const log: string[] = [`${SCENARIO_1939.name} started.`];
const app = document.getElementById("app")!;

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function describe(e: GameEvent): string {
  switch (e.type) {
    case "INITIATIVE_DETERMINED":
      return `${cap(e.season)} ${e.year}: ${cap(e.firstSide)} take the initiative (Axis ${e.axis} BRPs, Allies ${e.allies}).`;
    case "PLAYER_TURN_STARTED":
      return `${cap(e.side)} player turn begins.`;
    case "GAME_OVER":
      return `The scenario ends after ${cap(e.season)} ${e.year}.`;
  }
}

function label(a: Action): string {
  switch (a.type) {
    case "END_PLAYER_TURN":
      return `End ${cap(a.side)} turn`;
  }
}

function dispatch(action: Action): void {
  const result = applyAction(state, action);
  if (result.ok) {
    state = result.state;
    log.push(...result.events.map(describe));
  } else {
    log.push(`Not allowed: ${result.error}`);
  }
  render();
}

function render(): void {
  const totals = initiativeTotals(state);
  const actions = legalActions(state);
  const rows = Object.values(state.nations)
    .map(
      (n) => `<tr><td>${POWER_NAMES[n.id]}</td><td>${cap(n.status)}</td><td>${n.brpTotal}</td>
        <td>${spendingLimit(n)}</td><td>${n.growthRate}%</td></tr>`,
    )
    .join("");
  const status =
    state.phase === "game-over"
      ? "Game over"
      : `${cap(state.season)} ${state.year} &mdash; ${cap(state.activeSide)} player turn (${cap(state.firstSide)} hold the initiative)`;
  app.innerHTML = `
    <main>
      <h1>3Reich</h1>
      <p class="turn">${status}</p>
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      <table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>Spend limit</th><th>Growth</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="note">Map and units are not implemented yet. See docs/ROADMAP.md.</p>
      ${actions.map((a, i) => `<button data-action="${i}">${label(a)}</button>`).join(" ")}
      <ol class="log">${log.map((l) => `<li>${l}</li>`).join("")}</ol>
    </main>`;
  app.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => dispatch(actions[Number(button.dataset.action)]!));
  });
}

render();
