import type { Action } from "../engine/actions";
import { initiativeTotals } from "../engine/game";
import { POWER_NAMES, spendingLimit } from "../engine/nations";
import type { ForceOwner } from "../engine/types";
import { cap, sideName } from "./format";
import type { Session } from "./session";
import { setupPanel } from "./setupView";

/** The status area under the map: HTML text for each part, from the session. */

function turnLine(s: Session): string {
  const { state } = s;
  if (state.phase === "game-over") return "Game over";
  if (state.phase === "setup") return `${cap(state.season)} ${state.year} &mdash; setting up`;
  return `${cap(state.season)} ${state.year} &mdash; ${sideName(state.activeSide)} player turn (${cap(state.firstSide)} hold the initiative)`;
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
  const label = (a: Action) => (a.type === "END_PLAYER_TURN" ? `End ${sideName(a.side)} turn` : a.type);
  return `<div class="actions controls">${actions.map((a, i) => `<button data-action="${i}">${label(a)}</button>`).join("")}</div>`;
}

const logList = (s: Session) => `<ol class="log">${s.log.map((l) => `<li>${l}</li>`).join("")}</ol>`;

/** The whole status area. `mine` is the nation of yours that is setting up, or null. */
export function statusHtml(s: Session, mine: ForceOwner | null, actions: Action[]): string {
  const totals = initiativeTotals(s.state);
  return `
    <main>
      <p class="turn">${turnLine(s)}</p>
      ${mine ? setupPanel(s, mine) : ""}
      <p class="toast" role="status">${s.toast}</p>
      ${s.state.phase === "player-turn" ? `<p class="note">The computer opponent does not play yet, so you take both sides' turns for now.</p>` : ""}
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      ${nationTable(s)}
      ${turnButtons(actions)}
      ${logList(s)}
    </main>`;
}
