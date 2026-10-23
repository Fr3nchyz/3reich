import type { GameContext } from "../engine/context";
import { conquestHalf } from "../engine/conquest-income";
import { creditedObjectives, sovietOffer, SURRENDER_FACTOR_LIMIT, SURRENDER_RATIO, surrenderShortfall } from "../engine/soviet-surrender";
import { surrenderAsking } from "../engine/soviet-record";
import type { GameState } from "../engine/types";
import { alliedPowersConquered } from "../engine/victory";
import { computerToMove } from "./computerPlay";
import {
  SURRENDER_TEXT,
  surrenderAxisLine,
  surrenderCreditedLine,
  surrenderEndsGameLine,
  surrenderIncomeLine,
  surrenderRussianLine,
  surrenderWarning,
  surrenderWhyLine,
} from "./endText";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/**
 * Russia's offer to surrender on the screen (spec 14, part D5; ticket 14-16): the card the Axis player answers at step 10a, and the construction warning the Allied
 * player reads at step 8b. The models have no DOM and no rule: every number is the engine's (`sovietOffer`, the same test that made the offer; `creditedObjectives` and
 * `conquestHalf`, the same lists and rounding that acceptance uses; `surrenderShortfall`, the same test as the offer) and every sentence is in `endText.ts`.
 * The two answers are the engine's own `SURRENDER_ANSWER` actions, drawn by the status view as buttons.
 */

export interface SurrenderCard {
  title: string;
  /** The facts that led to the offer, one sentence each. */
  facts: string[];
  accept: { title: string; lines: string[] };
  refuse: { title: string; lines: string[] };
}

/** The card for this position, or null when the Axis is not being asked (no offer waits at step 10a). */
export function surrenderCard(ctx: GameContext, state: GameState): SurrenderCard | null {
  if (!surrenderAsking(state)) return null;
  const test = sovietOffer(ctx, state);
  const start = ctx.scenario.nations.ussr.brpTotal;
  const rules = ctx.scenario.victory;
  // Ref 2.4: only the Campaign ends on the third Allied Major Power; Russia is that third one when the others are down (V3: at once).
  const ends = rules.kind === "campaign" ? [surrenderEndsGameLine(alliedPowersConquered(state) + 1 >= rules.axis.decisivePowers)] : [];
  return {
    title: SURRENDER_TEXT.title,
    facts: [surrenderRussianLine(test.russian), surrenderAxisLine(test.axis), surrenderWhyLine(SURRENDER_FACTOR_LIMIT, SURRENDER_RATIO.axis, SURRENDER_RATIO.russian)],
    accept: {
      title: SURRENDER_TEXT.ifAccept,
      lines: [SURRENDER_TEXT.leavesWar, ...ends, surrenderCreditedLine(creditedObjectives(ctx, state).length), surrenderIncomeLine(conquestHalf(start), start)],
    },
    refuse: { title: SURRENDER_TEXT.ifRefuse, lines: [SURRENDER_TEXT.refuseGoesOn, SURRENDER_TEXT.refuseOnce] },
  };
}

/**
 * The card as HTML. `buttons` is the HTML of the two answers (`data-action` buttons drawn by the status view); the card is drawn only when there are some, so a computer
 * answering for the Axis (the Allies are the human, or a watched game) is not asked on the screen: the turn line says that it answers.
 */
export function surrenderCardHtml(s: Session, buttons: string): string {
  const c = surrenderCard(s.ctx, s.state);
  if (!c || buttons === "") return "";
  const list = (b: SurrenderCard["accept"]) => `<h3>${escape(b.title)}</h3><ul class="surrender-list">${b.lines.map((l) => `<li>${escape(l)}</li>`).join("")}</ul>`;
  return `<section class="surrendercard" id="surrender-card" aria-labelledby="surrender-title">
      <h2 id="surrender-title" tabindex="-1">${escape(c.title)}</h2>${c.facts.map((l) => `<p class="surrender-line">${escape(l)}</p>`).join("")}${list(c.accept)}${list(c.refuse)}
      <div class="surrender-buttons">${buttons}</div>
    </section>`;
}

/**
 * The construction warning (D5): the sentence for step 8b of an Allied Player Turn played by a person, or null. It is true only when the offer would follow
 * (`surrenderShortfall`), and its number falls as Russia builds.
 */
export function surrenderWarningText(s: Session): string | null {
  const { state } = s;
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "8b" || computerToMove(s)) return null;
  const n = surrenderShortfall(s.ctx, state);
  return n === null ? null : surrenderWarning(n);
}

/** The warning as a note under the build list, or "". */
export function surrenderWarningHtml(s: Session): string {
  const text = surrenderWarningText(s);
  return text === null ? "" : `<p class="surrender-warning" role="note">${escape(text)}</p>`;
}
