import type { GameEvent } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { OWNER_NAMES, POWER_NAMES } from "../engine/nations";
import type { GameState } from "../engine/types";
import { cap, nameOf, sideName, sweepLine } from "./format";
import { unitsWhere } from "./actionLabels";
import { lossLine, builtLine } from "./lossText";
import { plural } from "./attackText";
import { placeName, stackSummary, unitName, unitsWithIds } from "./names";
import { gameOverLine } from "./victoryLine";
import { conquestLine } from "./conquestText";
import { winterLine } from "./winterText";
import { attritionLine } from "./attritionText";
import { siberianLogLine } from "./endText";

/** `before` is the position the action was made in, where the counters it removes or moves are still found by id (names.ts). */
export function describeEvent(e: GameEvent, ctx: GameContext, swept: ReadonlySet<string>, routed: ReadonlyMap<string, boolean>, before: GameState): string | null {
  switch (e.type) {
    case "UNIT_PLACED":
    case "UNIT_REMOVED":
      return null;
    case "AIRBASE_PLACED":
      return `${POWER_NAMES[e.owner]} places an airbase at ${placeName(ctx.map, e.at)}.`;
    case "SETUP_OWNER_DONE":
      return `${OWNER_NAMES[e.owner]} has set up.`;
    case "SETUP_COMPLETE":
      return "Setup is complete.";
    case "INITIATIVE_DETERMINED":
      return `${cap(e.season)} ${e.year}: ${cap(e.firstSide)} take the initiative (Axis ${e.axis} BRPs, Allies ${e.allies}).`;
    case "PLAYER_TURN_STARTED":
      return `${sideName(e.side)} player turn begins.`;
    case "STEPS_PASSED":
      return null;
    case "UNIT_BUILT":
      return builtLine(e, POWER_NAMES[e.owner]);
    case "FRONT_OPTION_SELECTED":
      return `${sideName(e.side)} choose the ${cap(e.option)} Option on the ${cap(e.front)} Front${e.cost > 0 ? ` (${e.cost} BRPs)` : ""}.`;
    case "BRPS_GRANTED":
      return `${POWER_NAMES[e.from]} grants ${e.amount} BRPs to ${POWER_NAMES[e.to]}.`;
    case "BRPS_CHANGED":
      return `${POWER_NAMES[e.nation]}: ${e.delta} BRPs (${e.reason}), ${e.total} left.`;
    case "COUNTRY_INCOME":
      return `${POWER_NAMES[e.nation]} territory income ${e.total}: ${e.lines.map((l) => `${cap(l.name)} ${l.value} (${l.reason})`).join(", ")}.`;
    case "MINOR_DECLARATION_REVOKED":
      return `${POWER_NAMES[e.by]} did not enter or attack ${cap(e.minor)}: the declaration is revoked (${e.brpsLost} BRPs lost), ${cap(e.minor)} is neutral again.`;
    case "MINOR_GARRISONED":
      return `${POWER_NAMES[e.by]} garrisons ${cap(e.minor)}: the declaration of ${POWER_NAMES[e.revoked]} is revoked and ${cap(e.minor)} stays asleep.`;
    case "MINOR_ALLY_WOKE":
      return `${cap(e.minor)} wakes as an ally of ${POWER_NAMES[e.of]}${e.cause === "intervention" ? " (Intervention)" : ""}: ${e.value} BRPs join ${POWER_NAMES[e.of]}'s total${e.toPlace ? ", and its army is set up at step 2" : ""}.`;
    case "MINOR_INTERVENED":
      return `${POWER_NAMES[e.by]} intervenes in ${cap(e.minor)}: it fights beside ${POWER_NAMES[e.by]}.`;
    case "MINOR_FORCES_PLACED":
      return `${sideName(e.side)} set up the army of ${cap(e.minor)} (${e.units.length} counters).`;
    case "WAR_DECLARED":
      return `${POWER_NAMES[e.by]} declares war on ${nameOf(e.on)} (${e.cost} BRPs).`;
    case "UNITS_SWEPT":
      return sweepLine(ctx, e);
    case "COMBAT_RESOLVED":
      if (e.sweep) return null; // the line of the sweep says it
      return `Attack on ${placeName(ctx.map, e.target)}: ${e.attackFactors} against ${e.defenseFactors} x${e.multiplier}; ${e.rounds.map((r) => `${r.column ?? "no"} column, ${r.roll ?? "no roll"}: ${r.result}`).join("; ")} (${e.outcome}).`;
    case "UNIT_ELIMINATED":
      if (swept.has(e.unitId) || routed.has(e.unitId)) return null; // the line of its fate says it (lossText.ts); a game saved before spec 17 has none, so keeps this one
      return `Eliminated${e.reason === "unsupplied" ? " (out of supply)" : ""}: ${before.units[e.unitId] ? unitName(before.units[e.unitId]!) : `${OWNER_NAMES[e.owner]} unit`} in ${placeName(ctx.map, e.at)}.`;
    case "UNIT_RETURNED_TO_POOL":
    case "UNIT_LOST_FOR_GOOD":
      return swept.has(e.unitId) ? null : lossLine(ctx, before, e, routed.get(e.unitId));
    case "LOSSES_CHOSEN":
      return `${sideName(e.side)} chooses losses: ${unitsWhere(ctx, before, e.units)}.`;
    case "UNITS_MOVED":
      return `${stackSummary(unitsWithIds(before, e.units))} move from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}.`;
    case "UNITS_REDEPLOYED":
      return `${stackSummary(unitsWithIds(before, e.units))} redeployed from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)} (${POWER_NAMES[e.nation]} has ${e.left} left).`;
    case "AIR_STAGED":
      return `${stackSummary(unitsWithIds(before, e.units))} changed base from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}.`;
    case "AIR_MISSION_DESIGNATED":
      return `${stackSummary(unitsWithIds(before, e.units))} fly ground support to ${placeName(ctx.map, e.target)}.`;
    case "FLEET_DESIGNATED_FOR_SUPPLY":
      return `Supply by sea from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}, carried by ${stackSummary(unitsWithIds(before, e.fleets))}, for ${stackSummary(unitsWithIds(before, e.units))}.`;
    case "SEA_SUPPLY_LAPSED":
      return `The supply by sea from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)} no longer holds: ${e.reason}`;
    case "AIR_DISPLACED": {
      const name = stackSummary(unitsWithIds(before, [e.unitId]), true);
      return `${name} displaced from ${placeName(ctx.map, e.from)}: ${e.to === null ? "eliminated because no legal destination was available" : `moved to ${placeName(ctx.map, e.to)}`}.`;
    }
    case "FLEET_DISPLACED": {
      const fleet = before.units[e.unitId];
      const name = fleet ? unitName(fleet) : `${OWNER_NAMES[e.owner]} fleet`;
      return e.to === null ? `${name} at ${placeName(ctx.map, e.from)} was eliminated: ${placeName(ctx.map, e.from)} was taken and no friendly port on its Front has room.` : `${name} moved from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.to)}: ${placeName(ctx.map, e.from)} was taken.`;
    }
    case "GROUND_SUPPORT_LOST":
      return `${plural(e.units.reduce((n, u) => n + u.strength, 0), "air factor")} committed to ${placeName(ctx.map, e.hex)} were lost: the hex was not attacked.`;
    case "AIR_RESHAPED": {
      const side = before.units[e.before[0]!.id];
      return `${side ? `${OWNER_NAMES[side.owner]} air` : "Air"} at ${placeName(ctx.map, e.at)}: ${e.before.map((b) => b.strength).join(" + ")} became ${e.after.map((a) => a.strength).join(" + ")} air factors.`;
    }
    case "UNITS_ADVANCED":
      return `${stackSummary(unitsWithIds(before, e.units))} advance into ${placeName(ctx.map, e.to)}.`;
    case "BREAKTHROUGH":
      return `Breakthrough at ${placeName(ctx.map, e.hex)}${e.placeable.length > 0 ? `: ${e.placeable.length} armor unit${e.placeable.length === 1 ? "" : "s"} can move in free` : ""}.`;
    case "EXPLOITERS_PLACED":
      return `${stackSummary(unitsWithIds(before, e.units))} move into the Breakthrough at ${placeName(ctx.map, e.hex)}.`;
    case "EXPLOIT_MOVED":
      return e.path.length === 0 ? `${stackSummary(unitsWithIds(before, [e.unit]))} hold the Breakthrough at ${placeName(ctx.map, e.from)}.` : `${stackSummary(unitsWithIds(before, [e.unit]))} exploit from ${placeName(ctx.map, e.from)} to ${placeName(ctx.map, e.path.at(-1)!)}.`;
    case "FORTRESS_CHANGED": {
      const reasons = { "enemy-entered": "an enemy entered", sevastopol: "Sevastopol's control or supply conditions changed", "france-fell": "France has fallen", "west-wall": "the West Wall becomes fortified in 1944", "scenario-start": "the scenario begins" };
      return `${placeName(ctx.map, e.hex)} is ${e.status ? "now" : "no longer"} a fortress: ${reasons[e.why]}.`;
    }
    case "HEX_CONTROL_CHANGED":
      return `${nameOf(e.to)} takes control of ${e.hex}.`;
    case "OVERSTACK_ELIMINATED":
      return `${nameOf(e.owner)} loses a unit at ${e.at} to overstacking.`;
    case "CAPITAL_LOST":
    case "CAPITAL_RETAKEN":
    case "RUSSIA_BRPS_MOVED":
    case "RUSSIA_OFFERS_SURRENDER":
    case "RUSSIA_SURRENDERED":
    case "SURRENDER_REFUSED":
    case "OBJECTIVES_CREDITED":
    case "OCCUPATION_SHORT":
    case "OCCUPATION_PENALTY":
    case "COUNTRY_CONQUERED":
    case "VICHY_CREATED":
    case "ITALIAN_FLEET_KEPT":
    case "UNITS_REMOVED_BY_CONQUEST":
    case "CONTROL_PASSED":
      return conquestLine(ctx, e);
    case "WINTER_ROLLED":
    case "WINTER_POSTPONED":
    case "WINTER_STARTED":
      return winterLine(e);
    case "SIBERIAN_TRANSFER_USED":
      return siberianLogLine(e.strength, e.unitType, placeName(ctx.map, e.at), e.left, e.firstUse);
    case "GAME_OVER":
      return gameOverLine(e.season, e.year, e.result);
    case "ATTRITION_RESOLVED":
    case "ATTRITION_LOSSES_CHOSEN":
    case "ATTRITION_HEX_SELECTED":
    case "UNIT_RETREATED":
    case "ATTRITION_HEX_OCCUPIED":
      return attritionLine(e, ctx, before) ?? null;
  }
}
