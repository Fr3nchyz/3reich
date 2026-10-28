import type { Action } from "../engine/actions";
import type { GameState } from "../engine/types";
import { winterBansOffensive } from "../engine/winter-effects";
import { winterAsking, winterInForce, winterKey } from "../engine/winter-record";
import { axisUnitsLine, diceLine, postponedStartLine, testLine, WINTER_TEXT, winterBanner } from "./endText";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/**
 * The Russian winter on the screen (spec 14, part D4; ticket 14-13): the card at II.A, the banner under the turn line, the greyed Offensive button of step 3.
 * The models have no DOM and no rule: every number is the record's (`GameState.winter`, made by `winter.ts`) and every sentence is in `endText.ts`.
 * The card has two forms. Asked (`ask`): the Allies must answer, and the two buttons are the engine's own `CHOOSE_WINTER` actions. Told (`info`): the winter
 * starts with no question (the dice leave no choice, the Allies chose, a postponed winter comes round, or Russia declared in a Winter turn) and the card, with one
 * "OK" button, says so once; it changes nothing in the game.
 */

export interface WinterCard {
  kind: "ask" | "info";
  title: string;
  /** The facts, one sentence each: the dice, the count, the test, what the winter does. */
  lines: string[];
}

/** Whether the winter in force was rolled this Game Turn (the record keeps the last roll; a postponed winter and an early one have no dice of their own). */
const rolledThisTurn = (state: GameState): boolean => state.winter?.roll !== undefined && state.winter.postponedFrom === undefined;

/** The card for this position, or null. `seen` is the winter (its key) whose "OK" was already pressed or whose question the player answered. */
export function winterCard(state: GameState, seen: string | undefined): WinterCard | null {
  const w = state.winter;
  if (!w) return null;
  const asking = winterAsking(state);
  if (!asking && (!winterInForce(state) || seen === winterKey(state) || state.phase !== "player-turn")) return null;
  const roll = w.roll;
  const lines: string[] = [];
  if (asking || rolledThisTurn(state)) {
    lines.push(WINTER_TEXT.first);
    if (roll) lines.push(diceLine(roll.dice, roll.total), axisUnitsLine(roll.axisUnits), testLine(roll.axisUnits, roll.total, roll.mayPostpone, !asking));
  } else if (w.postponedFrom) lines.push(postponedStartLine(w.postponedFrom));
  else lines.push(WINTER_TEXT.declared);
  lines.push(`${asking ? "If the winter starts now, for this Game Turn: " : "For this Game Turn: "}${WINTER_TEXT.effects.charAt(0).toLowerCase()}${WINTER_TEXT.effects.slice(1)}`);
  return { kind: asking ? "ask" : "info", title: WINTER_TEXT.title, lines };
}

/** The banner under the turn line while the winter is on (the whole Game Turn, both Player Turns), or "". */
export function winterBannerHtml(state: GameState): string {
  return state.phase === "player-turn" && winterInForce(state) ? `<p class="winter-banner" role="note">${escape(winterBanner())}</p>` : "";
}

/**
 * The card as HTML. `buttons` is the HTML of the buttons for the Allied answer (`data-action` buttons drawn by the status view); the asked card is drawn only when
 * there are some (a computer answering for the Allies is not asked on the screen), the told one only to a person.
 */
export function winterCardHtml(s: Session, buttons: string): string {
  const c = winterCard(s.state, s.winterSeen);
  if (!c || (c.kind === "ask" && buttons === "") || (c.kind === "info" && s.watch)) return "";
  const lines = c.lines.map((l) => `<p class="winter-line">${escape(l)}</p>`).join("");
  const foot = c.kind === "ask" ? buttons : `<button type="button" id="winter-ok">${WINTER_TEXT.ok}</button>`;
  return `<section class="wintercard" id="winter-card" aria-labelledby="winter-title" data-kind="${c.kind}">
      <h2 id="winter-title" tabindex="-1">${escape(c.title)}</h2>${lines}
      <div class="winter-buttons">${foot}</div>
    </section>`;
}

/** The step-3 Offensive button the winter greys out: the text and the reason, or null when it is not in play (the winter off, not the Axis' step 3, or the Eastern Front already on Offensive; a choice of another Option can still be changed, spec 15 R14). */
export function greyedOffensive(state: GameState): { text: string; reason: string } | null {
  const step3 = state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step === "3";
  return step3 && state.frontOptions.eastern?.option !== "offensive" && winterBansOffensive(state, state.activeSide, "eastern", "offensive") ? { text: WINTER_TEXT.greyedOption, reason: WINTER_TEXT.greyedReason } : null;
}

/**
 * The buttons of the Front Options fold: the engine's choices, and the Offensive Option of the Eastern Front shown greyed (before the other Eastern choices, where it
 * would be) when the winter bans it. A greyed button is `aria-disabled`, not `disabled`, so that a tap still reaches it and says why (a touch screen has no hover).
 */
export function frontOptionButtons(state: GameState, group: readonly Action[], button: (a: Action) => string): string {
  const html = group.map(button);
  const grey = greyedOffensive(state);
  const at = group.findIndex((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "eastern");
  if (grey && at >= 0) html.splice(at, 0, `<button type="button" class="greyed" aria-disabled="true" data-winterwhy="1" title="${escape(grey.reason)}">${escape(grey.text)}</button>`);
  return html.join("");
}
