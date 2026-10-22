import type { GameContext } from "../engine/context";
import type { HexId } from "../engine/hex";
import { objectiveStandings } from "../engine/objectives";
import type { GameState } from "../engine/types";
import { objectiveCount, victoryTarget } from "../engine/victory";
import { END_TEXT, frontTitle, MARK_KEY, needsText, OBJECTIVES_BUTTON, rowLabel, scoreLine, SHOW_RESULT_BUTTON, SURRENDER_TEXT, type Holder } from "./endText";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/**
 * The "Victory and objectives" card (spec 14, part D1; Ref 2.0): the running score, the 42 Objectives by Front with who holds each, and what each
 * side needs. The model has no DOM; the HTML is built from it. A row is a button: tapping it centres the map on the Objective.
 */

export interface ObjectiveRow {
  hex: HexId;
  name: string;
  holder: Holder;
  /** The Allies hold it for good after Russia's surrender was accepted (spec 14 D5, R7c): whoever has the hex, it counts for them. */
  credited: boolean;
}

export interface ObjectivesCard {
  score: string;
  siberian: string;
  fronts: { title: string; rows: ObjectiveRow[] }[];
  needsTitle: string;
  needs: string[];
}

const FRONTS = ["western", "eastern", "mediterranean"] as const;

export function objectivesCard(ctx: GameContext, state: GameState): ObjectivesCard {
  const standings = objectiveStandings(ctx, state);
  const holderOf = (hex: HexId): Holder => (standings.axis.includes(hex) ? "Axis" : standings.allies.includes(hex) ? "Allies" : "nobody");
  const all = [...standings.axis, ...standings.allies, ...standings.nobody];
  const credited = new Set(state.soviet?.credited ?? []);
  const target = victoryTarget(ctx, state);
  const needs = needsText(target, ctx.scenario.end);
  return {
    score: scoreLine(target.counts),
    siberian: target.siberian ? END_TEXT.siberianIn : target.kind === "germany-falls" ? END_TEXT.siberianExempt : END_TEXT.siberianNot,
    fronts: FRONTS.map((front) => {
      const rows = all
        .filter((hex) => ctx.map.hexes[hex]?.front === front)
        .map((hex) => ({ hex, name: ctx.map.hexes[hex]?.name ?? hex, holder: holderOf(hex), credited: credited.has(hex) }))
        .sort((a, b) => a.name.localeCompare(b.name))
        ;
      return { title: frontTitle(front, rows.length), rows };
    }),
    needsTitle: needs.title,
    needs: needs.lines,
  };
}

/** The mark in front of a holder's name: a shape as well as words, so colour is never the only sign (it is the one drawn on the map). */
const SHAPE: Record<Holder, string> = { Axis: "■", Allies: "●", nobody: "◌" };

/** The score line with the buttons that open the card and, after a finished game, bring back the result card. Nothing during setup. */
export function scoreHtml(s: Session): string {
  if (s.state.phase === "setup") return "";
  const open = s.objectivesOpen === true;
  const showResult = s.state.phase === "game-over" && s.state.result !== undefined && s.endDismissed === true;
  return `<div class="score">
      <p class="score-line">${escape(scoreLine(objectiveCount(s.ctx, s.state)))}</p>
      <button id="obj-open" type="button" aria-expanded="${open}" aria-controls="obj-card">${OBJECTIVES_BUTTON}</button>
      ${showResult ? `<button id="end-show" type="button">${SHOW_RESULT_BUTTON}</button>` : ""}
    </div>${open ? cardHtml(objectivesCard(s.ctx, s.state)) : ""}`;
}

function cardHtml(c: ObjectivesCard): string {
  const row = (r: ObjectiveRow) => `<li><button type="button" class="obj-row" data-objhex="${r.hex}" aria-label="${escape(rowLabel(r.name, r.holder, r.credited))}"><span class="obj-name">${escape(r.name)}${r.credited ? `<small class="obj-credited">${SURRENDER_TEXT.credited}</small>` : ""}</span><span class="obj-holder holder-${r.holder.toLowerCase()}"><span aria-hidden="true">${SHAPE[r.holder]}</span> ${r.holder}</span></button></li>`;
  return `<section class="objcard" id="obj-card" aria-labelledby="obj-title">
      <div class="objcard-head"><h2 id="obj-title" tabindex="-1">${END_TEXT.objectivesTitle}</h2><button id="obj-close" type="button" aria-label="${END_TEXT.closeObjectives}">${END_TEXT.close}</button></div>
      <p class="objcard-held">${escape(c.score)}</p>
      <p class="objcard-siberian">${escape(c.siberian)}</p>
      <p class="objcard-key">${escape(MARK_KEY)}</p>
      <div class="objcard-fronts">${c.fronts.map((f) => `<div class="objcard-front"><h3>${escape(f.title)}</h3><ul>${f.rows.map(row).join("")}</ul></div>`).join("")}</div>
      <h3>${escape(c.needsTitle)}</h3>
      ${c.needs.map((l) => `<p class="objcard-needs">${escape(l)}</p>`).join("")}
    </section>`;
}

