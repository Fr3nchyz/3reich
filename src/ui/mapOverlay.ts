import { hex } from "../engine/hex";
import type { MapData } from "../engine/map";
import { hexCenter, hexCorners, points, type Point } from "./mapGeometry";
import type { Holder, OverlayCells } from "./overlayModel";

/** The SVG text of the control overlay: an outlined, lightly tinted inset hex for the holder of each hex, and a hatch for Zones of Control. */

/** The inset outline is the hex shrunk to this share of its size, so it never touches the printed hex edge or the country tint's border. */
export const CONTROL_INSET = 0.8;
/** The id of the hatch pattern defined in the map's <defs>. */
export const HATCH_ID = "zoc-hatch";

/** The pattern the Zone of Control hexes are filled with: thin diagonal lines, in map units. */
export const HATCH_DEFS = `<defs><pattern id="${HATCH_ID}" width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.6"/></pattern></defs>`;

const CLASS: Record<Holder, string> = { axis: "ctl-axis", allies: "ctl-allies", neutral: "ctl-neutral" };

function inset(id: string): string {
  const [cx, cy] = hexCenter(hex(id));
  return points(hexCorners(cx, cy).map(([x, y]) => [cx + (x - cx) * CONTROL_INSET, cy + (y - cy) * CONTROL_INSET] as Point));
}

/** The markup inside <g class="overlay">; empty when the overlay is off (cells null). Hexes not on the map are skipped. */
export function overlayMarkup(map: MapData, cells: OverlayCells | null): string {
  if (!cells) return "";
  let out = '<g class="control">';
  for (const holder of ["axis", "allies", "neutral"] as const) {
    for (const id of cells.control[holder]) if (map.hexes[id]) out += `<polygon class="${CLASS[holder]}" data-ctl="${id}" points="${inset(id)}"/>`;
  }
  out += '</g><g class="zoc">';
  for (const id of cells.zoc) {
    if (!map.hexes[id]) continue;
    const [cx, cy] = hexCenter(hex(id));
    out += `<polygon data-zoc="${id}" points="${points(hexCorners(cx, cy))}" fill="url(#${HATCH_ID})"/>`;
  }
  return `${out}</g>`;
}
