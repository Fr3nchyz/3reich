/**
 * The words of the air screens (spec 09, part D: all new text in one module, so a translation is not a hunt). Plain strings and small functions
 * from plain numbers; no HTML and no rules here. Board-game words: Ground Support, air factor, mission.
 */

const factors = (n: number): string => `${n} air factor${n === 1 ? "" : "s"}`;
const planes = (n: number): string => `${n} plane${n === 1 ? "" : "s"}`;

export const MARK_CHOSEN = "Chosen";
export const MARK_FREE = "Not chosen";
export const MARK_COMMITTED = "Already committed";
export const MARK_GREYED = "Cannot fly";

/** The reasons a plane in range cannot be added. */
export const REASON_FLOWN = "has already flown a mission this Game Turn";
export const REASON_NEW = "was built this Game Turn and cannot fly a mission yet";
/** Any other refusal of the engine for a plane in range (none is reachable today: the engine refuses only for the flown mark, the range and the cap, which have their own words). */
export const REASON_OTHER = "cannot be committed to this hex now";
export const reasonOverCap = (cap: number): string => `would take the air over the limit of ${factors(cap)} for this hex`;

export const NOTHING_CHOSEN = "Choose at least one plane";

/** The list "Air support you can add (3)" above the rows of step 7b. */
export const listTitle = (n: number): string => `Air support you can add (${n})`;
export const LIST_NOTE = "Tap a hex on the map, or its row here, to choose the planes. Their air factors are added to your attack on it, up to three times the ground factors; a plane flies one mission each Game Turn. A hex you commit planes to must be attacked this turn or the planes are lost, and a commitment cannot be taken back. Press \"Done with step 7b\" to commit nothing.";

/** The second line of a row: the planes that can reach the hex and the most the hex can take. */
export const rowReach = (n: number, available: number, cap: number): string => `${planes(n)} in range (${factors(available)}); at most ${factors(cap)} here`;
export const rowCommitted = (committed: number): string => `${factors(committed)} already committed`;

export const cardTitle = (place: string): string => `Air support for ${place}`;
export const CARD_HINT = "tap a plane to add or remove it";
export const cardTotals = (chosen: number, committed: number, cap: number): string =>
  `Air chosen: ${factors(chosen)}${committed > 0 ? `, ${factors(committed)} already committed` : ""}. At most ${factors(cap)} (three times the ground factors that could attack).`;
export const MUST_ATTACK = "You must attack this hex this turn, or these planes are lost.";
export const commitButton = (n: number, f: number, place: string): string => `Commit ${planes(n)} (${factors(f)}) to ${place}`;
export const hexesAway = (n: number): string => `${n} hex${n === 1 ? "" : "es"} away`;
export const CANCEL = "Cancel";
export const cardPlanes = (range: number): string => `Planes within ${range} hexes`;

/** The "Air support" part of the attack card at step 7h (spec 09, part D2). */
export const ATTACK_AIR_TITLE = "Air support";
export const ATTACK_AIR_HINT = "committed at step 7b";
export const PLANE_COUNTS = "Counts in this attack";
export const PLANE_LEFT_OUT = "Not counted: over the limit";
export const planeFrom = (place: string): string => `from ${place}`;
export const airCounts = (n: number): string => `${factors(n)} count in this attack. They cannot be taken back; they win or are lost with the attackers.`;
export const AIR_NONE_COUNT = "No committed air counts in this attack.";
export const AIR_LEFT_OUT_NOTE = "The air in an attack counts up to three times the ground factors. The planes not counted stay committed and are not lost.";
