import type { Action } from "../engine/actions";
import { initiativeTotals } from "../engine/game";
import { POWER_NAMES, spendingLimit } from "../engine/nations";
import { BRP_COSTS } from "../engine/tables";
import { isMajorPower } from "../engine/war";
import { describeStep } from "../engine/sequence";
import { cap, nameOf, sideName } from "./format";
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
        <td>${n.spent} of ${spendingLimit(n)} spent</td><td>${n.growthRate}%</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>This turn</th><th>Growth</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}

/** What a button says: "End Axis turn", "Done with step 1", "Germany declares war on Norway (10 BRPs)". */
function label(a: Action): string {
  switch (a.type) {
    case "END_PLAYER_TURN":
      return `End ${sideName(a.side)} turn`;
    case "END_STEP":
      return `Done with step ${a.step}`;
    case "DECLARE_WAR":
      return `${POWER_NAMES[a.by]} declares war on ${nameOf(a.on)} (${isMajorPower(a.on) ? BRP_COSTS.declareWarOnMajorPower : BRP_COSTS.declareWarOnMinorCountry} BRPs)`;
    default:
      return a.type;
  }
}

/**
 * One button per legal action; data-action is the index into `actions`. Declarations of war, of
 * which there are many, sit in a fold-out above the buttons that move the game on.
 */
function turnButtons(actions: Action[], open: boolean): string {
  const button = (a: Action) => `<button data-action="${actions.indexOf(a)}">${label(a)}</button>`;
  const wars = actions.filter((a) => a.type === "DECLARE_WAR");
  const rest = actions.filter((a) => a.type !== "DECLARE_WAR");
  const fold = wars.length > 0 ? `<details class="declarations"${open ? " open" : ""}><summary>Declare war (${wars.length} choices)</summary><div class="actions controls">${wars.map(button).join("")}</div></details>` : "";
  return `${fold}<div class="actions controls">${rest.map(button).join("")}</div>`;
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
      ${turnButtons(actions, s.declarationsOpen)}
      ${logList(s)}
    </main>`;
}
