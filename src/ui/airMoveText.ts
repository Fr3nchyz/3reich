/**
 * The words of the planes and airbases at step 6f (spec 09, part D1; all air text lives in airText.ts and here, so a translation is not a hunt).
 * Plain strings and small functions from plain numbers and names; no HTML and no rules. Board-game words: base, staging is "change base".
 */

const factors = (n: number): string => `${n} air factor${n === 1 ? "" : "s"}`;
const planes = (n: number): string => `${n} plane${n === 1 ? "" : "s"}`;

/** The list "Planes (3 bases)" under the stacks of step 6f. */
export const planesTitle = (n: number): string => `Planes at ${n} base${n === 1 ? "" : "s"}`;
export const PLANES_NOTE = "Tap a base on the map, or its row here, to see where its planes can go. A plane changes base once a turn, up to 8 hexes, and cannot cross neutral land.";
export const planesRow = (n: number, free: number): string => `${planes(n)}${free < n ? `, ${free} can still change base` : ""}`;

export const READY = "ready";
export const STAGED = "changed base this turn";
export const MARK_TICKED = "Ticked";
export const MARK_FREE = "Not ticked";

export const cardTitle = (place: string): string => `Planes at ${place}`;
export const baseLine = (held: number, capacity: number): string => `This base holds ${held} of ${capacity} air factors.`;
export const tickedCount = (ticked: number, all: number): string => `${ticked} of ${all} ticked.`;

export const basesTitle = (n: number): string => `Change base (up to 8 hexes): ${n} base${n === 1 ? "" : "s"}`;
export const baseRow = (hexes: number, room: number): string => `${hexes} hex${hexes === 1 ? "" : "es"}, room for ${factors(room)}`;
export const BASES_NOTE = "Planes cannot cross neutral land. “Take back last move” undoes a change of base, until you press Done with the step.";
export const NOTHING_TICKED = "Tick at least one plane.";
export const ALREADY_STAGED = "These planes have already changed base this turn: a plane changes base once a turn.";
export const NO_BASE = "No base is in reach for these planes together.";
export const basesCapped = (shown: number, all: number): string => `The ${shown} nearest of ${all} are listed. Tap the map for the others.`;
export const blockedTitle = (n: number): string => `Bases they cannot use (${n})`;

export const SPLIT_TITLE = "Split";
export const splitTitle = (name: string, ways: number): string => `Split the ${name} (${ways} way${ways === 1 ? "" : "s"})`;
export const splitButton = (parts: readonly number[]): string => parts.join(" + ");
export const joinButton = (total: number): string => `Join the ticked planes into one ${total}`;
export const joinWhy = (sizes: readonly number[]): string => `The ticked planes cannot be joined: only planes of one nation and one movement factor join, and the total must be a counter size (${sizes.join(", ")}).`;

export const SHOW_RANGE = "Show 4-hex range";
export const HIDE_RANGE = "Hide 4-hex range";
export const RANGE_NOTE = "The pale hexes are as far as these planes can fly on a mission from here (4 hexes).";

export const nextTickPlanes = (n: number): string => (n === 0 ? "Next: tick at least one plane, or cancel." : `Next: tap a yellow base to move the ${n === 1 ? "plane" : "planes"} there, or cancel.`);
export const NEXT_NO_BASE = "Next: these planes have no base to go to; split or join them, or cancel.";

/** Airbases. */
export const AIRBASES_TITLE = "Airbases";
export const AIRBASES_NOTE = "An airbase turns a hex into a base for 5 more air factors. Place it in a hex you hold and supply, at most one to a hex.";
export const airbaseRow = (power: string, left: number): string => `${power}: ${left} airbase${left === 1 ? "" : "s"} left to place`;
export const placeTitle = (power: string): string => `Place a ${power} airbase`;
export const placeAdvice = (power: string): string => `Tap a yellow hex to place the ${power} airbase there, or cancel.`;
export const NEXT_PLACE = "Next: tap a yellow hex to place the airbase, or cancel.";
export const NO_PLACE = "No hex can take an airbase now: it must be a hex you hold and supply, with no airbase in it.";
export const placeWhere = (n: number): string => `Where it can go (${n})`;
export const placedLine = (power: string, place: string): string => `Placed a ${power} airbase at ${place}.`;
export const NOT_A_PLACE = "An airbase cannot go there. The yellow hexes are the places it can.";

/** Taps on the map while a card is open. */
export const notABase = (place: string): string => `${place} is not a base: planes change base only to a city or a hex with an airbase.`;
export const CHOOSE_BASE = "Tap one of the yellow hexes: the bases the ticked planes can go to.";
export const stagedLine = (what: string, from: string, to: string): string => `${what} changed base from ${from} to ${to}.`;

export const NEXT_AIR_ONLY = "Next: tap a base with planes to change their base, place an airbase, or finish step 6f.";
