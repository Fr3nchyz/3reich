import { hex } from "../engine/hex";
import type { MapData } from "../engine/map";
import type { Unit } from "../engine/types";
import { escape, fmt, hexCenter, hexCorners, points } from "./mapGeometry";
import { unitSymbol } from "./mapSymbols";
import { OWNER_COLOURS, counterNumber, darken } from "./mapStyle";
import { NO_UNIT_MARKS, type UnitMarks } from "./moveMarks";

/** The SVG text of the counters and of the highlighted hexes, redrawn whenever the game changes. */

/** Counter size on the map, in SVG units: a square of cardboard, as on the printed board. */
const COUNTER_SIZE = 12.4;
/** A counter's top-left corner sits this far left of and above the hex centre. */
const COUNTER_LEFT = COUNTER_SIZE / 2;
const COUNTER_ABOVE = COUNTER_SIZE / 2 + 0.4;
/** The unit symbol is drawn this far below the counter's top edge (its centre), and the numbers this far above its bottom edge. */
const SYMBOL_DROP = 4.3;
const NUMBER_RISE = 1.5;
/** The shadow under a counter is offset by this much to the right and below. */
const SHADOW = 0.8;
/** Each counter in a stack is drawn this much up and to the right of the one below it. */
const STACK_STEP = 1.3;
/** At most this many counters of a stack are drawn; the rest show as "+n". */
const STACK_SHOWN = 4;
/** The "+n" for hidden counters sits this far right of and below the hex centre. */
const MORE_OFFSET = 7;

/** Counters grouped by the map hex they stand in; off-map boxes are listed outside the map. */
function stacksOnMap(map: MapData, units: readonly Unit[]): Map<string, Unit[]> {
  const stacks = new Map<string, Unit[]>();
  for (const u of units) {
    if (!map.hexes[u.at]) continue;
    (stacks.get(u.at) ?? stacks.set(u.at, []).get(u.at)!).push(u);
  }
  return stacks;
}

/** A ring this far outside the counter's edge. */
const RING_OUTSET = 1.1;

/**
 * The marks of the Move card on one counter (spec 10, 10-5): ticked to move = a gold ring (dark case under it), left behind = a pale veil with a
 * bar across the middle. Shape differs, so colour is never the only cue. Widths are screen pixels (move.css, non-scaling stroke).
 */
function markMarkup(mark: "ticked" | "left", x: number, y: number): string {
  const size = COUNTER_SIZE;
  if (mark === "ticked") {
    const r = `x="${fmt(x - RING_OUTSET)}" y="${fmt(y - RING_OUTSET)}" width="${fmt(size + 2 * RING_OUTSET)}" height="${fmt(size + 2 * RING_OUTSET)}" rx="1.6"`;
    return `<rect class="ring-case" ${r}/><rect class="ring" ${r}/>`;
  }
  const bar = `x1="${fmt(x + 2)}" y1="${fmt(y + size / 2)}" x2="${fmt(x + size - 2)}" y2="${fmt(y + size / 2)}"`;
  return `<rect class="veil" x="${fmt(x)}" y="${fmt(y)}" width="${size}" height="${size}" rx=".7"/><line class="dash-case" ${bar}/><line class="dash" ${bar}/>`;
}

/** One counter: a shadow, the cardboard in its nation's colour with a printed border, the unit symbol and the numbers. */
function counterMarkup(u: Unit, at: string, x: number, y: number, mark?: "ticked" | "left"): string {
  const c = OWNER_COLOURS[u.owner];
  const edge = darken(c.fill, 0.4);
  const size = COUNTER_SIZE;
  return `<g data-at="${at}"${mark ? ` data-mark="${mark}"` : ""}>` +
    `<rect x="${fmt(x + SHADOW)}" y="${fmt(y + SHADOW)}" width="${size}" height="${size}" rx=".7" fill="#000" opacity=".3"/>` +
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${size}" height="${size}" rx=".7" fill="${c.fill}" stroke="${edge}" stroke-width=".6"/>` +
    `<rect x="${fmt(x + 0.9)}" y="${fmt(y + 0.9)}" width="${fmt(size - 1.8)}" height="${fmt(size - 1.8)}" fill="none" stroke="${c.text}" stroke-width=".3" opacity=".7"/>` +
    unitSymbol(u.type, x + size / 2, y + SYMBOL_DROP, size * 0.9, c.text) +
    `<text x="${fmt(x + size / 2)}" y="${fmt(y + size - NUMBER_RISE)}" fill="${c.text}">${escape(counterNumber(u))}</text>` +
    (mark ? markMarkup(mark, x, y) : "") + `</g>`;
}

export function unitsMarkup(map: MapData, units: readonly Unit[], marks: UnitMarks = NO_UNIT_MARKS): string {
  let out = "";
  for (const [at, stack] of stacksOnMap(map, units)) {
    const [cx, cy] = hexCenter(hex(at));
    // Draw the stack bottom to top, each counter a little up and to the right of the one below it.
    stack.slice(-STACK_SHOWN).forEach((u, i) => {
      out += counterMarkup(u, at, cx - COUNTER_LEFT + i * STACK_STEP, cy - COUNTER_ABOVE - i * STACK_STEP, marks.ticked.has(u.id) ? "ticked" : marks.left.has(u.id) ? "left" : undefined);
    });
    if (stack.length > STACK_SHOWN) out += `<text class="more" x="${fmt(cx + MORE_OFFSET)}" y="${fmt(cy + MORE_OFFSET)}">+${stack.length - STACK_SHOWN}</text>`;
  }
  return out;
}

/** An outline around each of these hexes that is on the map (places where the selected counter may go); `further` is the second shade (spec 10: where a faster unit alone could go). */
export function highlightsMarkup(map: MapData, ids: Iterable<string>, further: Iterable<string> = []): string {
  let out = "";
  const draw = (id: string, cls: string) => {
    if (!map.hexes[id]) return;
    const [cx, cy] = hexCenter(hex(id));
    out += `<polygon${cls} data-hl="${id}" points="${points(hexCorners(cx, cy))}"/>`;
  };
  for (const id of ids) draw(id, "");
  for (const id of further) draw(id, ' class="further"');
  return out;
}
