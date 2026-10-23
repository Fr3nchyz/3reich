import type { Action } from "../engine/actions";
import { initiativeTotals } from "../engine/game";
import { POWER_NAMES, spendingLimit } from "../engine/nations";
import { BRP_COSTS } from "../engine/tables";
import { isMajorPower } from "../engine/war";
import { describeStep } from "../engine/sequence";
import { winterAsking } from "../engine/winter-record";
import { surrenderAsking } from "../engine/soviet-record";
import { SURRENDER_TEXT, WINTER_TEXT } from "./endText";
import { frontOptionButtons, winterBannerHtml, winterCardHtml } from "./winterCard";
import { surrenderCardHtml } from "./surrenderCard";
import { computerSide, computerToMove } from "./computerPlay";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { cap, nameOf, sideName } from "./format";
import { combatLabel, labelled } from "./actionLabels";
import type { Session, SetupView } from "./session";
import { buildPanel } from "./buildView";
import { siberianCardHtml, siberianEndLabel, siberianShown } from "./siberianCard";
import { setupPanel } from "./setupView";
import { logHtml } from "./logView";
import { panelHtml } from "./watchBar";
import { hexCardHtml } from "./hexCardView";
import { attackHtml } from "./attackView";
import { leadsStatus, nextBarHtml } from "./nextBar";
import { moveHtml } from "./moveView";
import { airHtml } from "./airCardView";
import { airMoveHtml } from "./airMoveView";
import { endHtml, statusText } from "./endCard";
import { scoreHtml } from "./objectivesCard";

/** The status area under the map: HTML text for each part, from the session. */

function turnLine(s: Session): string {
  const { state } = s;
  if (state.phase === "game-over") return statusText(state);
  if (state.phase === "setup") return `${cap(state.season)} ${state.year} &mdash; setting up`;
  // At II.A the Allies are asked about the Russian winter, whoever played last: the line says so instead of naming the side that played; when the computer answers for them it says that (also in a watched game).
  if (winterAsking(state)) return `${cap(state.season)} ${state.year} &mdash; step II.A (Russian winter): ${computerToMove(s) ? WINTER_TEXT.askLineComputer : WINTER_TEXT.askLine}`;
  // At 10a the Axis answer Russia's offer to surrender in the middle of the Allied Player Turn: the line says so.
  if (surrenderAsking(state)) return `${cap(state.season)} ${state.year} &mdash; step ${describeStep("10a")}: ${computerToMove(s) ? SURRENDER_TEXT.askLineComputer : SURRENDER_TEXT.askLine}`;
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
      return a.step === "8a" ? siberianEndLabel(state) : `Done with step ${a.step}`; // the Free Siberian Transfer card's closing button (ticket 14-18)
    case "DECLARE_WAR":
      return `${POWER_NAMES[a.by]} declares war on ${nameOf(a.on)} (${isMajorPower(a.on) ? BRP_COSTS.declareWarOnMajorPower : BRP_COSTS.declareWarOnMinorCountry} BRPs)`;
    case "SELECT_FRONT_OPTION":
      return `${cap(a.front)} Front: ${cap(a.option)} Option${a.payer ? ` (${BRP_COSTS.offensiveOption} BRPs from ${POWER_NAMES[a.payer]})` : ""}`;
    case "CHOOSE_WINTER":
      return a.postpone ? WINTER_TEXT.wait : WINTER_TEXT.start; // the buttons of the winter card (winterCard.ts)
    case "SURRENDER_ANSWER":
      return a.accept ? SURRENDER_TEXT.accept : SURRENDER_TEXT.refuse;
    case "ELIMINATE_OVERSTACK":
      return "Choose for me: eliminate the fewest and weakest units that bring each hex within its limit";
    case "GRANT_BRPS":
      return `${POWER_NAMES[a.from]} grants ${a.amount} BRPs to ${POWER_NAMES[a.to]}`;
    default:
      return combatLabel(a, ctx, state) ?? a.type;
  }
}

/** The buttons of a list of legal actions with their words, as shown: builds and moves have their own panels (redeployments get one in ticket 16-19) (so does the Free Siberian Transfer: its card), identical actions appear once, and no two read alike. */
export function buttonLabels(actions: Action[], ctx: GameContext, state: GameState) {
  return labelled(actions.filter((a) => a.type !== "BUILD" && a.type !== "MOVE" && a.type !== "SR_UNITS" && a.type !== "SIBERIAN_TRANSFER"), ctx, state, (a) => label(a, ctx, state));
}

/**
 * One button per legal action; data-action is the index into `actions`. Declarations of war and grants, of
 * which there are many, sit in fold-outs above the buttons that move the game on. Builds are not buttons:
 * they have their own panel (buildView). The losses and the advance after a battle are the cards of choiceView.ts, with their
 * old buttons in fold-outs for a keyboard.
 */
/** The folds of the combat buttons: their inner row is not `.actions`, so the buttons that move the game on stay the last `.actions` buttons in the page (the browser tests click that one). */
const COMBAT_FOLDS: readonly Action["type"][] = ["ATTACK", "ALLOCATE_LOSSES", "ADVANCE", "DESIGNATE_AIR"];

function turnButtons(actions: Action[], open: boolean, ctx: GameContext, state: GameState, cardEnds8a: boolean): { folds: string; rest: string; winter: string; surrender: string; siberian: string } {
  const shown = buttonLabels(actions, ctx, state);
  const text = new Map(shown.map((l) => [l.action, l.text]));
  const button = (a: Action) => `<button data-action="${actions.indexOf(a)}">${text.get(a)}</button>`;
  const fold = (type: Action["type"], title: string) => {
    const group = actions.filter((a) => a.type === type && text.has(a));
    return group.length === 0 ? "" : `<details class="declarations"${open ? " open" : ""}><summary>${title} (${group.length} ${group.length === 1 ? "choice" : "choices"})</summary><div class="${COMBAT_FOLDS.includes(type) ? "fold-buttons" : "actions"} controls">${type === "SELECT_FRONT_OPTION" ? frontOptionButtons(state, group, button) : group.map(button).join("")}</div></details>`;
  };
  const rest = actions.filter((a) => text.has(a) && a.type !== "DECLARE_WAR" && a.type !== "GRANT_BRPS" && a.type !== "BUILD" && a.type !== "SELECT_FRONT_OPTION" && a.type !== "MOVE" && a.type !== "ATTACK" && a.type !== "ALLOCATE_LOSSES" && a.type !== "ADVANCE" && a.type !== "DESIGNATE_AIR" && a.type !== "CHOOSE_WINTER" && a.type !== "SURRENDER_ANSWER" && !(cardEnds8a && a.type === "END_STEP" && a.step === "8a"));
  return {
    folds: `${fold("ATTACK", "All attacks as a list")}${fold("ALLOCATE_LOSSES", "All ways to lose, as a list")}${fold("ADVANCE", "All advances as a list")}${fold("DESIGNATE_AIR", "All air support as a list")}${fold("DECLARE_WAR", "Declare war")}${fold("SELECT_FRONT_OPTION", "Choose a Front Option")}${fold("GRANT_BRPS", "Grant BRPs")}`,
    rest: rest.map(button).join(""),
    siberian: cardEnds8a ? actions.filter((a) => a.type === "END_STEP" && a.step === "8a" && text.has(a)).map(button).join("") : "", // the closing button of the Free Siberian Transfer card (ticket 14-18)
    winter: actions.filter((a) => a.type === "CHOOSE_WINTER" && a.postpone && text.has(a)).concat(actions.filter((a) => a.type === "CHOOSE_WINTER" && !a.postpone && text.has(a))).map(button).join(""), // waiting first, as the card of spec 14 D4 shows it
    surrender: actions.filter((a) => a.type === "SURRENDER_ANSWER" && text.has(a)).map(button).join(""), // the engine's order: accept, then refuse (the card of D5)
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
  const { folds, rest, winter, surrender, siberian } = turnButtons(actions, s.foldOpen, s.ctx, s.state, siberianShown(s));
  const toast = `<p class="toast" role="status">${s.toast}</p>`;
  // Step 7h: the bar, the message and the cards come first, so the next thing to do is in view; everything else follows.
  const lead = leadsStatus(s);
  return `
    <main>
      <p class="turn">${turnLine(s)}</p>
      ${winterBannerHtml(s.state)}${winterCardHtml(s, winter)}${surrenderCardHtml(s, surrender)}${siberianCardHtml(s, actions, siberian)}
      ${scoreHtml(s)}
      ${lead ? `${nextBarHtml(s, actions, rest)}${toast}${attackHtml(s, actions)}${airHtml(s, actions)}${moveHtml(s, actions)}${airMoveHtml(s)}` : ""}
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
      ${endHtml(s)}
    </main>`;
}
