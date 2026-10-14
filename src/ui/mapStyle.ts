import type { Front } from "../engine/map";
import type { ForceOwner, Unit } from "../engine/types";

/** Colours and marks for the map. Drawn in our own style (no scanned artwork). */

/**
 * The printed-board look (the owner's pick, "A"): a pale tint for each country so the map reads like the
 * box map, a pale blue sea, and the terrain shown by a small mark instead of a different ground colour.
 */
export const SEA = "#bcd6e6";
const UNKNOWN_COUNTRY = "#e0dccd";
export const COUNTRY_TINT: Record<string, string> = {
  germany: "#d9d2bd", poland: "#ecdc9f", france: "#bcd0ea", britain: "#e7cfa9", ussr: "#d9c3a6", sweden: "#cfe0c0",
  "baltic-states": "#e3d0c6", rumania: "#d8d1e6", italy: "#d3dcb8", norway: "#dfe6c8", ireland: "#c5e0c8", hungary: "#e6c5c0",
  finland: "#d3dde0", denmark: "#ecc9c9", netherlands: "#f0d7ae", belgium: "#efe3a8", luxembourg: "#e5e5e5", spain: "#e8d7b5",
  yugoslavia: "#d4cfc0", portugal: "#e2d3b8", albania: "#d9d0c0", greece: "#cfdde6", bulgaria: "#dcd0c8", turkey: "#ead9b4",
  libya: "#ecdcae", egypt: "#efe0b0", tunisia: "#e9d2b9", algeria: "#e6d6b4", morocco: "#e3cfa9", palestine: "#e8dcc0",
  transjordan: "#e8d8b4", "lebanon-syria": "#e4d6bc", iraq: "#e6d8b2", persia: "#e5d5b6", arabia: "#ecdcb0",
};
/** The ground colour of a land hex. The Qattara Depression is told apart by its own sandy colour. */
export const landFill = (country: string | undefined, terrain: string): string =>
  terrain === "qattara-depression" ? "#d9c58c" : COUNTRY_TINT[country ?? ""] ?? UNKNOWN_COUNTRY;
export const FRONT_TINT: Record<Front, string> = { western: "#d1495b", eastern: "#3d5a98", mediterranean: "#e0a526" };

/** A colour darkened by this share (0 = unchanged, 1 = black), for the edge of a counter. */
export function darken(colour: string, share: number): string {
  const n = parseInt(colour.slice(1), 16);
  const part = (shift: number) => Math.round(((n >> shift) & 255) * (1 - share)).toString(16).padStart(2, "0");
  return `#${part(16)}${part(8)}${part(0)}`;
}

/** Counter colours follow the printed counters: plain colours and numbers, no emblems. */
export const OWNER_COLOURS: Record<ForceOwner, { fill: string; text: string }> = {
  germany: { fill: "#3a3340", text: "#f2efe2" },
  italy: { fill: "#8e99b0", text: "#101418" },
  france: { fill: "#5b8ad0", text: "#101418" },
  "vichy-france": { fill: "#5b8ad0", text: "#101418" },
  "free-france": { fill: "#5b8ad0", text: "#101418" },
  britain: { fill: "#d9b46a", text: "#101418" },
  ussr: { fill: "#a0663e", text: "#f2efe2" },
  usa: { fill: "#7ea642", text: "#101418" },
  poland: { fill: "#e6c54f", text: "#101418" },
  finland: { fill: "#b4b0a4", text: "#101418" },
  rumania: { fill: "#b4b0a4", text: "#101418" },
  hungary: { fill: "#b4b0a4", text: "#101418" },
  bulgaria: { fill: "#b4b0a4", text: "#101418" },
};

const TYPE_MARK: Record<string, string> = { infantry: "", armor: "▭", airborne: "⌃", replacement: "r", air: "✈", fleet: "⚓", airbase: "", bridgehead: "" };

/** The numbers printed on a counter: strength, and movement for ground and air units ("3-4", "9"). */
export const counterNumber = (u: Pick<Unit, "strength" | "movement">): string => `${u.strength}${u.movement !== undefined ? `-${u.movement}` : ""}`;

/** One counter's label: "3-4" for ground and air units, "9" for fleets, with a mark for the type. */
export function counterLabel(u: Pick<Unit, "type" | "strength" | "movement">): string {
  const mark = TYPE_MARK[u.type] ?? "";
  return `${mark}${u.strength}${u.movement !== undefined ? `-${u.movement}` : ""}`;
}
