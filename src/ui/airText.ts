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
