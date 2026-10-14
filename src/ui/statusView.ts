import type { Action } from "../engine/actions";
import { initiativeTotals } from "../engine/game";
import { POWER_NAMES, spendingLimit } from "../engine/nations";
import { BRP_COSTS } from "../engine/tables";
import { isMajorPower } from "../engine/war";
import { describeStep } from "../engine/sequence";
import { computerSide, computerToMove } from "./computerPlay";
import { cap, nameOf, sideName } from "./format";
import type { Session, SetupView } from "./session";
import { buildPanel } from "./buildView";
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
        <td>${n.spent} of ${spendingLimit(n)} spent</td><td>${n.brpBase}</td><td>${n.growthRate}%</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>Nation</th><th>Status</th><th>BRPs</th><th>This turn</th><th>Base</th><th>Growth</th></tr></thead>
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
    case "SELECT_FRONT_OPTION":
      return `${cap(a.front)} Front: ${cap(a.option)} Option${a.payer ? ` (${BRP_COSTS.offensiveOption} BRPs from ${POWER_NAMES[a.payer]})` : ""}`;
    case "GRANT_BRPS":
      return `${POWER_NAMES[a.from]} grants ${a.amount} BRPs to ${POWER_NAMES[a.to]}`;
    case "ATTACK":
      return `Attack ${a.target} with ${a.units.join(", ")}`;
    case "ALLOCATE_LOSSES":
      return `Lose ${a.units.join(", ")}`;
    case "ADVANCE":
      return `Advance ${a.units.join(", ")} into ${a.to}`;
    default:
      return a.type;
  }
}

/**
 * One button per legal action; data-action is the index into `actions`. Declarations of war and grants, of
 * which there are many, sit in fold-outs above the buttons that move the game on. Builds are not buttons:
 * they have their own panel (buildView).
 */
function turnButtons(actions: Action[], open: boolean): string {
  const button = (a: Action) => `<button data-action="${actions.indexOf(a)}">${label(a)}</button>`;
  const fold = (type: Action["type"], title: string) => {
    const group = actions.filter((a) => a.type === type);
    return group.length === 0 ? "" : `<details class="declarations"${open ? " open" : ""}><summary>${title} (${group.length} choices)</summary><div class="actions controls">${group.map(button).join("")}</div></details>`;
  };
  const rest = actions.filter((a) => a.type !== "DECLARE_WAR" && a.type !== "GRANT_BRPS" && a.type !== "BUILD" && a.type !== "SELECT_FRONT_OPTION");
  return `${fold("DECLARE_WAR", "Declare war")}${fold("SELECT_FRONT_OPTION", "Choose a Front Option")}${fold("GRANT_BRPS", "Grant BRPs")}<div class="actions controls">${rest.map(button).join("")}</div>`
}

/** What step 3 asks for, and what is already chosen. */
function frontPrompt(s: Session, actions: Action[]): string {
  if (!actions.some((a) => a.type === "SELECT_FRONT_OPTION")) return "";
  const chosen = Object.entries(s.state.frontOptions).map(([front, c]) => `${cap(front)}: ${c.option}`);
  return `<p class="note">Front Options (step 3): choose an Option for each Front you want to act on. A Front you leave alone is on the Defensive Option; the Offensive Option costs ${BRP_COSTS.offensiveOption} BRPs.${chosen.length ? ` Chosen so far &mdash; ${chosen.join(", ")}.` : ""}</p>`;
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
      ${computerToMove(s) ? `<p class="computer-status" role="status">Computer is playing the ${sideName(computerSide(s))} turn...</p>` : ""}
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      ${nationTable(s)}
      ${frontPrompt(s, actions)}
      ${buildPanel(s, actions)}
      ${turnButtons(actions, s.foldOpen)}
      ${logList(s)}
    </main>`;
}
