import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { turnKey, victoryTarget } from "../engine/victory";
import { verdictName } from "../engine/victory-record";
import { decidedBy, END_TEXT, gameOverLine, needLines, scenarioEnded, scoreLine, verdictMeaning } from "./endText";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/**
 * The result card (spec 14, part D2): a dialog over the page when a game ends, with the verdict, why, the Objective counts and what the winner needed.
 * The model has no DOM; the HTML is built from it. A watched game shows its result in the watch panel instead (the card would cover the controls).
 */

export interface EndCard {
  label: string;
  title: string;
  meaning: string;
  /** Why the game ended, one sentence each. */
  reasons: string[];
  counts: string;
  /** What the winner needed, or what each side missed in a Stalemate; empty for the scenarios decided by conquest. */
  needs: string[];
  siberian: string | null;
}

/** The card for a finished game, or null while the game goes on (and for a game over that was saved without a result). */
export function endCard(ctx: GameContext, state: GameState): EndCard | null {
  const r = state.result;
  if (state.phase !== "game-over" || !r) return null;
  const target = victoryTarget(ctx, state);
  const checkpoint = target.axis ? state.victory?.checkpoints[turnKey(target.axis.marginal.at)] : undefined;
  const why = decidedBy(target.kind, r, checkpoint, target.axis);
  const ended = scenarioEnded(r.at);
  // A Stalemate says what the spec says; an early end or a game that ended by holding on says what decided it (which already says when); otherwise the scenario ended, and a result that
  // rests on more than the count (a conquest at the end, the Campaign's tests) says what decided it too.
  const reasons = r.winner === null ? [END_TEXT.stalemateReason] : r.early || r.basis === "turn-limit" ? [why] : r.basis === "objectives" && checkpoint === undefined ? [ended] : [ended, why];
  return {
    label: END_TEXT.label,
    title: verdictName(r),
    meaning: verdictMeaning(r),
    reasons,
    counts: scoreLine(r.objectives),
    needs: needLines(r, target),
    siberian: r.siberian ? END_TEXT.siberianUsed : null,
  };
}

/** The status line text of a finished game ("Game over: Allied Marginal Victory"), or "Game over" without a result. */
export const statusText = (state: GameState): string => (state.result ? gameOverLine(verdictName(state.result)) : "Game over");

/** Whether the card is on the screen: a finished single-player game, until "Look at the map" or "Read the log" puts it away. */
export const endShown = (s: Session): boolean => s.state.phase === "game-over" && s.state.result !== undefined && !s.watch && s.endDismissed !== true;

export function endHtml(s: Session): string {
  const c = endShown(s) ? endCard(s.ctx, s.state) : null;
  if (!c) return "";
  const lines = (xs: readonly string[], cls: string) => xs.map((x) => `<p class="${cls}">${escape(x)}</p>`).join("");
  return `<div class="end-overlay"><section class="endcard" id="end-card" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <p class="end-label">${escape(c.label)}</p>
      <h2 id="end-title" tabindex="-1">${escape(c.title)}</h2>
      <p class="end-meaning">${escape(c.meaning)}</p>
      ${lines(c.reasons, "end-reason")}
      <p class="end-counts">${escape(c.counts)}</p>
      ${lines(c.needs, "end-need")}
      ${c.siberian ? lines([c.siberian], "end-siberian") : ""}
      <div class="end-buttons"><button id="end-look" type="button">${END_TEXT.look}</button><button id="end-log" type="button">${END_TEXT.log}</button><button id="end-new" type="button">${END_TEXT.newGame}</button></div>
    </section></div>`;
}
