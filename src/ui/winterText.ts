import type { GameEvent } from "../engine/actions";
import type { GameTurn } from "../engine/types";
import { cap } from "./format";

/**
 * The log lines of the Russian winter (spec 14 R10, D4). A minimal wording for now: the card of D4, the banner and the greyed button are a later screen
 * ticket (14-13), which will read the same events. One line for the dice, one when the Allies wait, one when the winter starts. Nothing here says what the
 * winter does to the fighting: that is ticket 14-12.
 */
const turnName = (t: GameTurn): string => `${cap(t.season)} ${t.year}`;

export function winterLine(e: GameEvent): string | null {
  switch (e.type) {
    case "WINTER_ROLLED":
      return `Russian winter: the dice show ${e.dice.join(", ")}, a total of ${e.total}. The Axis has ${e.axisUnits} ground unit${e.axisUnits === 1 ? "" : "s"} in Russia (Finns not counted), so the Allies ${e.mayPostpone ? "may put the winter off for a year" : "cannot put the winter off"}.`;
    case "WINTER_POSTPONED":
      return `The Allies put the Russian winter off: it starts in the next Winter turn.`;
    case "WINTER_STARTED":
      return e.early
        ? `The Soviet Union declared war on Germany in a Winter turn: the Russian winter starts now, in ${turnName(e.turn)}.`
        : `The Russian winter starts in ${turnName(e.turn)}${e.postponedFrom ? `, put off from ${turnName(e.postponedFrom)}` : ""}.`;
    default:
      return null;
  }
}
