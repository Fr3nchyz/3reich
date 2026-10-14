import type { Action } from "../engine/actions";
import { initiativeTotals } from "../engine/game";
import { POWER_NAMES, spendingLimit } from "../engine/nations";
import { describeStep } from "../engine/sequence";
import { cap, sideName } from "./format";
import type { Session, SetupView } from "./session";
import { setupPanel } from "./setupView";

/** The status area under the map: HTML text for each part, from the session. */

function turnLine(s: Session): string {
  const { state } = s;
  if (state.phase === "game-over") return "Game over";
  if (state.phase === "setup") return `${cap(state.season)} ${state.year} &mdash; setting up`;
  const step = state.position?.part === "player-turn" ? ` &mdash; step ${describeStep(state.position.step)}` : "";
  return `${cap(state.season)} ${state.year} &mdash; ${sideName(state.activeSide)} player turn (${cap(state.firstSide)} hold the initiative)${step}`;
}

/** The nation table: status, BRPs, spend limit and growth. */
function nationTable(s: Session): string {
  const rows = Object.values(s.state.nations)
    .map(
      (n) => `<tr><td>${POWER_NAMES[n.id]}</td><td>${cap(n.status)}</td><td>${n.brpTotal}</td>
        <td>${spendingLimit(n)}</td><td>${n.growthRate}%</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>Spend limit</th><th>Growth</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}

/** One button per legal action (End turn, ...); data-action is the index into `actions`. */
function turnButtons(actions: Action[]): string {
  const label = (a: Action) => {
    if (a.type === "END_PLAYER_TURN") return `End ${sideName(a.side)} turn`;
    return a.type === "END_STEP" ? `Done with step ${a.step}` : a.type;
  };
  return `<div class="actions controls">${actions.map((a, i) => `<button data-action="${i}">${label(a)}</button>`).join("")}</div>`;
}

const logList = (s: Session) => `<ol class="log">${s.log.map((l) => `<li>${l}</li>`).join("")}</ol>`;

/** The whole status area. `setup` is set while a nation of yours is setting up. */
export function statusHtml(s: Session, setup: SetupView | null, actions: Action[]): string {
  const totals = initiativeTotals(s.state);
  return `
    <main>
      <p class="turn">${turnLine(s)}</p>
      ${setup ? setupPanel(s, setup) : ""}
      <p class="toast" role="status">${s.toast}</p>
      ${s.state.phase === "player-turn" ? `<p class="note">The computer opponent does not play yet, so you take both sides' turns for now.</p>` : ""}
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      ${nationTable(s)}
      ${turnButtons(actions)}
      ${logList(s)}
    </main>`;
}
