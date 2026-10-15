import type { Action } from "../engine/actions";
import { initiativeTotals } from "../engine/game";
import { POWER_NAMES, spendingLimit } from "../engine/nations";
import { BRP_COSTS } from "../engine/tables";
import { isMajorPower } from "../engine/war";
import { describeStep } from "../engine/sequence";
import { computerSide, computerToMove } from "./computerPlay";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { cap, nameOf, sideName } from "./format";
import { combatLabel, labelled } from "./actionLabels";
import type { Session, SetupView } from "./session";
import { buildPanel } from "./buildView";
import { setupPanel } from "./setupView";
import { logHtml } from "./logView";
import { panelHtml } from "./watchBar";
import { hexCardHtml } from "./hexCardView";
import { attackHtml } from "./attackView";
import { leadsStatus, nextBarHtml } from "./nextBar";
import { moveHtml } from "./moveView";

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

/**
 * What a button says: "End Axis turn", "Done with step 1", "Germany declares war on Norway (10 BRPs)", "Attack Warsaw (M35) with 3-4 German
 * armor from Lodz (N33)". Combat buttons name places and counters, never ids (names.ts).
 */
function label(a: Action, ctx: GameContext, state: GameState): string {
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
    default:
      return combatLabel(a, ctx, state) ?? a.type;
  }
}

/** The buttons of a list of legal actions with their words, as shown: builds and moves have their own panels, identical actions appear once, and no two read alike. */
export function buttonLabels(actions: Action[], ctx: GameContext, state: GameState) {
  return labelled(actions.filter((a) => a.type !== "BUILD" && a.type !== "MOVE"), ctx, state, (a) => label(a, ctx, state));
}

/**
 * One button per legal action; data-action is the index into `actions`. Declarations of war and grants, of
 * which there are many, sit in fold-outs above the buttons that move the game on. Builds are not buttons:
 * they have their own panel (buildView). The losses and the advance after a battle are the cards of choiceView.ts, with their
 * old buttons in fold-outs for a keyboard.
 */
/** The folds of the combat buttons: their inner row is not `.actions`, so the buttons that move the game on stay the last `.actions` buttons in the page (the browser tests click that one). */
const COMBAT_FOLDS: readonly Action["type"][] = ["ATTACK", "ALLOCATE_LOSSES", "ADVANCE"];

function turnButtons(actions: Action[], open: boolean, ctx: GameContext, state: GameState): { folds: string; rest: string } {
  const shown = buttonLabels(actions, ctx, state);
  const text = new Map(shown.map((l) => [l.action, l.text]));
  const button = (a: Action) => `<button data-action="${actions.indexOf(a)}">${text.get(a)}</button>`;
  const fold = (type: Action["type"], title: string) => {
    const group = actions.filter((a) => a.type === type && text.has(a));
    return group.length === 0 ? "" : `<details class="declarations"${open ? " open" : ""}><summary>${title} (${group.length} ${group.length === 1 ? "choice" : "choices"})</summary><div class="${COMBAT_FOLDS.includes(type) ? "fold-buttons" : "actions"} controls">${group.map(button).join("")}</div></details>`;
  };
  const rest = actions.filter((a) => text.has(a) && a.type !== "DECLARE_WAR" && a.type !== "GRANT_BRPS" && a.type !== "BUILD" && a.type !== "SELECT_FRONT_OPTION" && a.type !== "MOVE" && a.type !== "ATTACK" && a.type !== "ALLOCATE_LOSSES" && a.type !== "ADVANCE");
  return {
    folds: `${fold("ATTACK", "All attacks as a list")}${fold("ALLOCATE_LOSSES", "All ways to lose, as a list")}${fold("ADVANCE", "All advances as a list")}${fold("DECLARE_WAR", "Declare war")}${fold("SELECT_FRONT_OPTION", "Choose a Front Option")}${fold("GRANT_BRPS", "Grant BRPs")}`,
    rest: rest.map(button).join(""),
  };
}

/** What step 3 asks for, and what is already chosen. */
function frontPrompt(s: Session, actions: Action[]): string {
  if (!actions.some((a) => a.type === "SELECT_FRONT_OPTION")) return "";
  const chosen = Object.entries(s.state.frontOptions).map(([front, c]) => `${cap(front)}: ${c.option}`);
  return `<p class="note">Front Options (step 3): choose an Option for each Front you want to act on. A Front you leave alone is on the Defensive Option; the Offensive Option costs ${BRP_COSTS.offensiveOption} BRPs.${chosen.length ? ` Chosen so far &mdash; ${chosen.join(", ")}.` : ""}</p>`;
}

/** The whole status area. `setup` is set while a nation of yours is setting up. */
export function statusHtml(s: Session, setup: SetupView | null, actions: Action[]): string {
  const totals = initiativeTotals(s.state);
  const { folds, rest } = turnButtons(actions, s.foldOpen, s.ctx, s.state);
  const toast = `<p class="toast" role="status">${s.toast}</p>`;
  // Step 7h: the bar, the message and the cards come first, so the next thing to do is in view; everything else follows.
  const lead = leadsStatus(s);
  return `
    <main>
      <p class="turn">${turnLine(s)}</p>
      ${lead ? `${nextBarHtml(s, actions, rest)}${toast}${attackHtml(s, actions)}${moveHtml(s, actions)}` : ""}
      ${s.watch ? panelHtml(s) : ""}
      ${setup ? setupPanel(s, setup) : ""}
      ${lead ? "" : toast}
      ${computerToMove(s) && !s.watch ? `<p class="computer-status" role="status">Computer is playing the ${sideName(computerSide(s))} turn...</p>` : ""}
      <p>Axis BRPs: ${totals.axis} &middot; Allied BRPs: ${totals.allies}</p>
      ${nationTable(s)}
      ${frontPrompt(s, actions)}
      ${buildPanel(s, actions)}
      ${folds}${lead ? "" : `<div class="actions controls">${rest}</div>`}
      ${hexCardHtml(s)}
      ${logHtml(s.log, s.logSides)}
    </main>`;
}
