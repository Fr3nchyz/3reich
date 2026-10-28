import { POWER_NAMES } from "../engine/nations";
import type { PowerId } from "../engine/types";

/**
 * Every sentence the Redeploy panel of step 9e says, in one place (spec 16 D4, D6; a later French pass is a translation, as for moveText.ts). Plain English,
 * built from counter names and place names the caller passes in, never from an id. Pure string functions; nothing here decides a rule.
 */

export const PANEL_TITLE = "Redeploy";
export const NEXT_CHOOSE = "Next: choose a stack to redeploy, or finish step 9e.";
export const NEXT_TICK = (n: number): string => (n === 0 ? "Next: tick the units to redeploy." : "Next: tap a yellow hex, then confirm.");
export const NEXT_CONFIRM = "Next: confirm the redeployment, or choose another hex.";
export const PROMPT = "Tap a stack of yours (on the map or in the list) to see where it can be redeployed. Redeploying is optional.";
export const REPLACEMENTS_NOTE = "Replacements move only by redeployment.";
export const CHOOSE_FIRST = "Choose a stack of yours first: tap one in the list or on the map.";
export const NOTHING_TICKED = "Tick at least one unit.";
export const NO_ESCORT = "Redeployment across the sea by Sea Escort is not built yet.";

/** The reasons a unit cannot be redeployed (D4). */
export const REASON_ENEMY = "next to an enemy unit";
export const REASON_SUPPLY = "cut off from supply";
export const REASON_LAND = "not on land your side controls";
export const REASON_DONE = "already redeployed this turn";
export const REASON_NOWHERE = "no free hex it can reach";
export const REASON_OTHER = "cannot be redeployed now";
export const reasonNone = (power: PowerId): string => `${POWER_NAMES[power]} has no redeployments left`;

export const UNDO_BUTTON = "Take back last redeployment";
export const UNDO_NOTHING = "Nothing to take back: no redeployment made yet.";
export const DONE_BUTTON = "Done with redeployment";
export const CONFIRM_BUTTON = "Redeploy";
export const CHANGE_BUTTON = "Choose another hex";
export const CANCEL_BUTTON = "Cancel";
export const TOOK_BACK_PREFIX = "Took back: ";
export const tookBack = (line: string): string => `${TOOK_BACK_PREFIX}${line}`;

/** "Germany 6 of 9 left." */
export const allowanceLine = (power: PowerId, left: number, of: number): string => `${POWER_NAMES[power]} ${left} of ${of} left.`;

/** "Germany will have 4 left." (several nations: one sentence each). */
export const willHave = (power: PowerId, left: number): string => `${POWER_NAMES[power]} will have ${left} left.`;

/** "Redeploy 2 German infantry from Berlin (K30) to Lodz (N33)?" */
export const confirmQuestion = (units: string, from: string, to: string): string => `Redeploy ${units} from ${from} to ${to}?`;

/** "Redeployed 2 German infantry from A to B." */
export const redeployedLine = (units: string, from: string, to: string): string => `Redeployed ${units} from ${from} to ${to}.`;

export const canMove = (n: number): string => `${n} ${n === 1 ? "unit" : "units"} can be redeployed`;
export const tickedCount = (ticked: number, tickable: number): string => `${ticked} of ${tickable} ticked.`;
export const whereSummary = (n: number): string => `Where they can go (${n})`;
export const whereCapped = (shown: number, all: number): string => `Showing ${shown} of ${all} places; the map shows them all.`;
export const cannotSummary = (n: number): string => `Units that cannot be redeployed (${n})`;
export const noRoom = "These units have no hex they can all go to together.";
export const overAllowance = (power: PowerId, left: number): string =>
  `${POWER_NAMES[power]} has ${left === 0 ? "no redeployments" : left === 1 ? "1 redeployment" : `${left} redeployments`} left: untick some of its units.`;

/** Why a tapped hex is not a place the ticked units can go (D6: a tap that cannot be chosen explains itself). */
export const WHY_NOT_LAND = "That is not a land hex.";
export const WHY_NOT_CONTROL = "Your side does not control that hex.";
export const WHY_NOT_ENEMY = "That hex is on or next to an enemy unit.";
export const WHY_NOT_SUPPLY = "That hex is cut off from supply.";
export const whyNotReached = (from: string): string => `That hex cannot be reached from ${from} through your own supplied land.`;
export const WHY_NOT_FIT = "The units would not fit there: it would be overstacked, or the stop ban for the Anglo-French forces applies.";
