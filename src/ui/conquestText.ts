import type { GameEvent } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { POWER_NAMES } from "../engine/nations";
import { nameOf } from "./format";
import { placeName } from "./names";

/**
 * The log lines of a conquest (spec 14 R4, D3). A minimal wording for now: the banner and the card of D3 are a later screen ticket, which will
 * read the same events. One line for the warning, one when the capital is taken back, one for the fall itself; the units and the land passed are in
 * the fall's line, so their own events say nothing.
 */
export function conquestLine(ctx: GameContext, e: GameEvent): string | null {
  switch (e.type) {
    case "CAPITAL_LOST":
      return `${placeName(ctx.map, e.capital)} has been taken. ${POWER_NAMES[e.power]} falls at the end of its own Combat Phase unless it takes ${placeName(ctx.map, e.capital)} back.`;
    case "RUSSIA_BRPS_MOVED":
      return `The Axis takes ${e.city === "moscow" ? "Moscow" : "Leningrad"} for the first time: ${e.amount > 0 ? `+${e.amount} BRPs` : "no BRPs"} for ${POWER_NAMES.germany}, ${e.lost > 0 ? `-${e.lost} BRPs` : "no BRPs lost"} for the ${POWER_NAMES.ussr}.`;
    case "RUSSIA_OFFERS_SURRENDER":
      return `Russia offers to surrender: it has ${e.russian} ground and air factors on the map, and the Axis has ${e.axis} inside Russia. The Axis must accept or refuse.`;
    case "RUSSIA_SURRENDERED":
      return "The Axis accept Russia's surrender: Russia leaves the war.";
    case "SURRENDER_REFUSED":
      return "The Axis refuse Russia's surrender: the war goes on until the last Russian unit inside Russia is gone, and Russia will not offer again.";
    case "OBJECTIVES_CREDITED":
      return `${e.hexes.length} objective${e.hexes.length === 1 ? " now counts" : "s now count"} for the Allies for good: ${e.hexes.map((h) => placeName(ctx.map, h)).join(", ")}.`;
    case "OCCUPATION_SHORT":
      return `The Axis Occupation Force in Russia is short: ${e.total} factors, ${e.ground} of them ground, against 45 and 30.`;
    case "OCCUPATION_PENALTY":
      return `Occupation Force penalty: ${POWER_NAMES.germany} loses ${e.amount} BRPs${e.hex === null ? "; no Russian Objective is left to hand back" : ` and ${placeName(ctx.map, e.hex)} goes back to Russia for good`}.`;
    case "CAPITAL_RETAKEN":
      return `${POWER_NAMES[e.power]} has taken back ${placeName(ctx.map, e.capital)}.`;
    case "COUNTRY_CONQUERED":
      if (e.how === "surrender") return `${nameOf(e.country)} is out of the game: ${e.unitsRemoved} unit${e.unitsRemoved === 1 ? " leaves" : "s leave"} the game; its land stays as it is and is closed to the Axis.`;
      return `${nameOf(e.country)} has been conquered by ${nameOf(e.by)}: ${e.unitsRemoved} unit${e.unitsRemoved === 1 ? " leaves" : "s leave"} the game and ${e.hexesPassed} hex${e.hexesPassed === 1 ? " changes" : "es change"} hands.`;
    case "VICHY_CREATED": {
      const lost = e.halved.lost;
      const colony = (c: (typeof e.colonies)[number]) => `${c.colony === "lebanon-syria" ? "Lebanon-Syria" : "Tunisia, Algeria and Morocco"} ${c.colony === "lebanon-syria" ? "is" : "are"} ${c.becomes === "vichy" ? "Vichy French" : "Free French"}`;
      const british = e.britishEliminated > 0 ? ` ${e.britishEliminated} British unit${e.britishEliminated === 1 ? " in" : "s in"} Vichy territory ${e.britishEliminated === 1 ? "is" : "are"} eliminated.` : "";
      return `Vichy France now exists. ${e.halved.kept} French unit${e.halved.kept === 1 ? "" : "s"} became Vichy and ${lost} ${lost === 1 ? "was" : "were"} lost. ${e.colonies.map(colony).join(". ")}.${british}`;
    }
    case "ITALIAN_FLEET_KEPT":
      return `Italy surrenders. The die is ${e.die}: Germany keeps ${e.share} of ${e.available} Italian naval factors${e.placed < e.counters ? ` (${e.counters - e.placed} counter${e.counters - e.placed === 1 ? "" : "s"} found no German port and ${e.counters - e.placed === 1 ? "is" : "are"} lost)` : ""}.`;
    case "UNITS_REMOVED_BY_CONQUEST":
    case "CONTROL_PASSED":
      return null;
    default:
      return null;
  }
}
