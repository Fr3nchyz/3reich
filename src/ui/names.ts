import type { GameContext } from "../engine/context";
import type { ForceOwner, GameState, Unit, UnitType } from "../engine/types";
import { OWNER_NAMES } from "../engine/nations";

/**
 * Plain names for the places and counters the screen talks about, so that no label has to show a unit id
 * ("u94") or make the player know a coordinate (spec 07, Decisions 7 and 8). Pure functions over the map data and
 * the game state; nothing here decides a rule.
 */

/** The printed name of an off-map box (Ref 4.3 names them on the map). */
const BOX_NAMES: Readonly<Record<string, string>> = { "us-box": "US Box", "murmansk-box": "Murmansk Box" };

/** "Warsaw (M35)": the place name first and the coordinate in brackets. A hex with no printed name is just its coordinate ("M35"). */
export function placeName(map: GameContext["map"], id: string): string {
  const box = BOX_NAMES[id];
  if (box) return box;
  const name = map.hexes[id]?.name?.trim();
  return name ? `${name} (${id})` : id;
}

/** What a nation's counters are called: "German armor", "Polish infantry". */
const ADJECTIVES: Readonly<Record<ForceOwner, string>> = {
  germany: "German",
  italy: "Italian",
  ussr: "Soviet",
  britain: "British",
  france: "French",
  usa: "American",
  poland: "Polish",
  "free-france": "Free French",
  "vichy-france": "Vichy French",
  finland: "Finnish",
  rumania: "Rumanian",
  hungary: "Hungarian",
  bulgaria: "Bulgarian",
  arabia: "Arabian",
  belgium: "Belgian",
  denmark: "Danish",
  greece: "Greek",
  ireland: "Irish",
  luxembourg: "Luxembourgish",
  netherlands: "Dutch",
  norway: "Norwegian",
  persia: "Persian",
  portugal: "Portuguese",
  spain: "Spanish",
  sweden: "Swedish",
  turkey: "Turkish",
  yugoslavia: "Yugoslav",
};

/** The nation a counter belongs to, as an adjective: its nationality if it has one, else its owner ("Italian" for the Italian fleet Germany holds). */
export const nationAdjective = (u: Pick<Unit, "owner" | "nationality">): string => ADJECTIVES[u.nationality ?? u.owner];

/** The counter's printed numbers: "3-4" (combat and movement) for ground and air units, "3" for a counter with a single factor. */
export const factorsOf = (u: Pick<Unit, "strength" | "movement">): string => (u.movement === undefined ? `${u.strength}` : `${u.strength}-${u.movement}`);

const KIND_WORDS: Readonly<Record<UnitType, string>> = {
  infantry: "infantry",
  armor: "armor",
  airborne: "airborne",
  replacement: "replacement",
  air: "air",
  fleet: "fleet",
  airbase: "airbase",
  bridgehead: "bridgehead",
};

/**
 * One counter in words: "3-4 German armor". With `held` a counter whose nationality differs from its owner says who holds it
 * ("3 Italian fleet, held by Germany").
 */
export function unitName(u: Pick<Unit, "owner" | "nationality" | "type" | "strength" | "movement">, held = false): string {
  const base = `${factorsOf(u)} ${nationAdjective(u)} ${KIND_WORDS[u.type]}`;
  return held && u.nationality && u.nationality !== u.owner ? `${base}, held by ${OWNER_NAMES[u.owner]}` : base;
}

/** A stack in words: identical counters are counted ("2 x 3-4 German infantry, 1-6 Polish air"), in the order they first appear. */
export function stackSummary(units: readonly Pick<Unit, "owner" | "nationality" | "type" | "strength" | "movement">[], held = false): string {
  const counts = new Map<string, number>();
  for (const u of units) {
    const key = unitName(u, held);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return "no units";
  return [...counts].map(([name, n]) => (n > 1 ? `${n} x ${name}` : name)).join(", ");
}

/** The counters with these ids that are still in the game, in the order given; an id that is not found is skipped, never printed. */
export const unitsWithIds = (state: Pick<GameState, "units">, ids: readonly string[]): Unit[] => ids.flatMap((id) => state.units[id] ?? []);
