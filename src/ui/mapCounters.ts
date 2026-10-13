import { hex } from "../engine/hex";
import type { MapData } from "../engine/map";
import type { Unit } from "../engine/types";
import { escape, fmt, hexCenter, hexCorners, points } from "./mapGeometry";
import { OWNER_COLOURS, counterLabel } from "./mapStyle";

/** The SVG text of the counters and of the highlighted hexes, redrawn whenever the game changes. */

/** Counter size on the map, in SVG units. */
const COUNTER_W = 9.2;
const COUNTER_H = 6;
/** A counter's top-left corner sits this far left of and above the hex centre. */
const COUNTER_LEFT = 4.6;
const COUNTER_ABOVE = 2.6;
/** The label's baseline sits this far below the counter's top edge. */
const COUNTER_BASELINE = 4.3;
/** Each counter in a stack is drawn this much up and to the right of the one below it. */
const STACK_STEP = 1.3;
/** At most this many counters of a stack are drawn; the rest show as "+n". */
const STACK_SHOWN = 4;

/** Counters grouped by the map hex they stand in; off-map boxes are listed outside the map. */
function stacksOnMap(map: MapData, units: readonly Unit[]): Map<string, Unit[]> {
  const stacks = new Map<string, Unit[]>();
  for (const u of units) {
    if (!map.hexes[u.at]) continue;
    (stacks.get(u.at) ?? stacks.set(u.at, []).get(u.at)!).push(u);
  }
  return stacks;
}

function counterMarkup(u: Unit, at: string, x: number, y: number): string {
  const c = OWNER_COLOURS[u.owner];
  return `<g data-at="${at}"><rect x="${fmt(x)}" y="${fmt(y)}" width="${COUNTER_W}" height="${COUNTER_H}" rx=".8" fill="${c.fill}" stroke="#101418" stroke-width=".5"/>` +
    `<text x="${fmt(x + COUNTER_W / 2)}" y="${fmt(y + COUNTER_BASELINE)}" fill="${c.text}">${escape(counterLabel(u))}</text></g>`;
}

export function unitsMarkup(map: MapData, units: readonly Unit[]): string {
  let out = "";
  for (const [at, stack] of stacksOnMap(map, units)) {
    const [cx, cy] = hexCenter(hex(at));
    // Draw the stack bottom to top, each counter a little up and to the right of the one below it.
    stack.slice(-STACK_SHOWN).forEach((u, i) => {
      out += counterMarkup(u, at, cx - COUNTER_LEFT + i * STACK_STEP, cy - COUNTER_ABOVE - i * STACK_STEP);
    });
    if (stack.length > STACK_SHOWN) out += `<text class="more" x="${fmt(cx + 6)}" y="${fmt(cy + 6)}">+${stack.length - STACK_SHOWN}</text>`;
  }
  return out;
}

/** An outline around each of these hexes that is on the map (places where the selected counter may go). */
export function highlightsMarkup(map: MapData, ids: Iterable<string>): string {
  let out = "";
  for (const id of ids) {
    if (!map.hexes[id]) continue;
    const [cx, cy] = hexCenter(hex(id));
    out += `<polygon data-hl="${id}" points="${points(hexCorners(cx, cy))}"/>`;
  }
  return out;
}
