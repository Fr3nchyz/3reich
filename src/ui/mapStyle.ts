import type { Front } from "../engine/map";
import type { ForceOwner, Unit } from "../engine/types";

/** Colours and marks for the map. Drawn in our own style (no scanned artwork). */

export const TERRAIN_FILL: Record<string, string> = {
  plain: "#8fae6a",
  mountains: "#b08a5a",
  swamp: "#8a9a8e",
  "qattara-depression": "#cfb47a",
};
export const SEA = "#9cc3df";
export const FRONT_TINT: Record<Front, string> = { western: "#d1495b", eastern: "#3d5a98", mediterranean: "#e0a526" };

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

/** One counter's label: "3-4" for ground and air units, "9" for fleets, with a mark for the type. */
export function counterLabel(u: Pick<Unit, "type" | "strength" | "movement">): string {
  const mark = TYPE_MARK[u.type] ?? "";
  return `${mark}${u.strength}${u.movement !== undefined ? `-${u.movement}` : ""}`;
}
