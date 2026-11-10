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

/** Spec 09 D3/D4 and spec 12 R14: mission cards and event results (09-15). */
export const MISSION_TITLES = { "7c": "Counter-air", "7d": "Defend with air?", "7e": "Intercept defensive air support", "7i": "Air attacks on ports" };
export const MISSION_NOTES = {
  "7c": "Assigned planes fight the air at these bases. Resolve to roll the combats.",
  "7d": "Choose planes for a threatened hex, then commit. Commitments cannot be taken back; each plane uses its mission for this Game Turn.",
  "7e": "Choose interceptors for a defensive air support target. Intercept rolls the combat immediately and uses their missions for this Game Turn.",
  "7i": "Resolve the assigned port attacks against the fleets still there.",
};
export const DAS_PASS = "Done with air defence, continue";
export const INTERCEPT_PASS = "No more interceptions, continue";
export const MISSION_CONTINUE = "Continue";
export const MISSION_RESOLVE = "Resolve";
export const MISSION_COMMIT = "Commit planes";
export const MISSION_INTERCEPT = "Intercept";
export const MISSION_RESULTS = "Air mission results";
export const AIR_ATTACKER = "Attacker";
export const AIR_DEFENDER = "Defender";
export const AUTOMATIC_AIR_LOSSES = "Air losses are allocated automatically, including counter breakdown. No loss choice is pending.";
export const missionPlane = (name: string, base: string) => `${name} from ${base}`;
export const missionChosen = (n: number) => `${factors(n)} chosen`;
export const missionCommitted = (names: readonly string[]) => `Already committed: ${names.join(", ")}`;
export const missionResultTitle = (kind: string, place: string) => `${kind} at ${place}`;
export const missionRoll = (role: string, die: number, f: number, advantage: number, nationality: number, total: number) =>
  `${role}: ${f} factors; die ${die}, advantage ${advantage >= 0 ? "+" : ""}${advantage}, nationality ${nationality >= 0 ? "+" : ""}${nationality}; modified roll ${total}.`;
export const missionTie = (n: number) => `Tie die: ${n}.`;
export const missionLoss = (a: number, d: number) => `Actual losses: ${a} attacking air factors, ${d} defending air factors.`;
export const missionContinuation = (n: number) => `${n} defensive air support plane${n === 1 ? "" : "s"} continue; all other support aborts.`;
export const missionWinner = (winner: "attacker" | "defender" | null) => winner === null ? "Tie." : `${winner === "attacker" ? AIR_ATTACKER : AIR_DEFENDER} wins.`;
export const PORT_STATUS = { resolved: "Resolved", "no-air": "No assigned planes remain", "no-fleets": "No enemy fleets remain", "counter-air-blocked": "Blocked: defending air was not beaten" };
export const portRolls = (rolls: readonly number[]) => `Dice: ${rolls.length ? rolls.join(", ") : "none"}.`;
export const portLosses = (air: number, hits: number, naval: number) => `Actual losses: ${air} air factors; ${hits} naval hits, ${naval} naval factors lost.`;
