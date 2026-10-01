import { hex, type Hex } from "../engine/hex";
import type { Front, MapData, MapHex } from "../engine/map";

/**
 * Read-only SVG map. Drawn in our own style from the map data (no scanned artwork).
 * Pointy-top hexes; axial (q, r) from engine/hex.ts.
 */

const SIZE = 10;
const SQRT3 = Math.sqrt(3);

export function hexCenter(h: Hex): [number, number] {
  return [SIZE * SQRT3 * (h.q + h.r / 2), SIZE * 1.5 * h.r];
}

/** Corner k of a pointy-top hex, k = 0 at the top, clockwise. */
function corner(cx: number, cy: number, k: number): [number, number] {
  const a = (Math.PI / 180) * (60 * k - 90);
  return [cx + SIZE * Math.cos(a), cy + SIZE * Math.sin(a)];
}

/** Corner indices bounding the side shared with the neighbour at (dq, dr). */
const SIDE_CORNERS: Record<string, [number, number]> = {
  "1,-1": [0, 1], "1,0": [1, 2], "0,1": [2, 3], "-1,1": [3, 4], "-1,0": [4, 5], "0,-1": [5, 0],
};

const TERRAIN_FILL: Record<string, string> = {
  plain: "#8fae6a",
  mountains: "#b08a5a",
  swamp: "#8a9a8e",
  "qattara-depression": "#cfb47a",
};
const SEA = "#9cc3df";
const FRONT_TINT: Record<Front, string> = { western: "#d1495b", eastern: "#3d5a98", mediterranean: "#e0a526" };

const fmt = (n: number) => n.toFixed(1);
const points = (pts: [number, number][]) => pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function sideSegment(id: string): [number, number, number, number] {
  const [aId, bId] = id.split("-") as [string, string];
  const a = hex(aId);
  const b = hex(bId);
  const [cx, cy] = hexCenter(a);
  const [k1, k2] = SIDE_CORNERS[`${b.q - a.q},${b.r - a.r}`]!;
  const [x1, y1] = corner(cx, cy, k1);
  const [x2, y2] = corner(cx, cy, k2);
  return [x1, y1, x2, y2];
}

function star(cx: number, cy: number, r: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return points(pts);
}

function citySymbol(h: MapHex, cx: number, cy: number): string {
  const f = h.features;
  const objective = f.includes("objective");
  const colour = objective ? "#b3202a" : "#1d1d1d";
  let out = "";
  if (f.includes("capital") || f.includes("capital-port")) {
    out += `<polygon points="${star(cx, cy, 3.6)}" fill="${colour}"/>`;
    if (f.includes("capital-port")) out += `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="4.6" fill="none" stroke="${colour}" stroke-width="0.8"/>`;
  } else if (f.includes("port")) {
    out += `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="2.4" fill="#fff" stroke="${colour}" stroke-width="1"/>`;
  } else if (f.includes("city") || objective) {
    out += `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="1.8" fill="${colour}"/>`;
  }
  if (h.fortress) {
    out += `<polygon points="${points([0, 1, 2, 3, 4, 5].map((k) => corner(cx, cy, k)).map(([x, y]) => [cx + (x - cx) * 0.78, cy + (y - cy) * 0.78] as [number, number]))}" fill="none" stroke="#333" stroke-width="0.9" stroke-dasharray="1.2 1"/>`;
  }
  if (h.name) {
    out += `<text x="${fmt(cx)}" y="${fmt(cy + 7.2)}" class="city${objective ? " objective" : ""}">${escape(h.name)}</text>`;
  }
  return out;
}

export interface MapViewOptions {
  showFronts?: boolean;
  onHover?: (h: MapHex | null) => void;
}

export function renderMap(container: HTMLElement, map: MapData, opts: MapViewOptions = {}): { setFronts(on: boolean): void } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hexLayer = "", frontLayer = "", cityLayer = "";
  for (const h of Object.values(map.hexes)) {
    const [cx, cy] = hexCenter(hex(h.id));
    const pts = [0, 1, 2, 3, 4, 5].map((k) => corner(cx, cy, k));
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const fill = h.land ? TERRAIN_FILL[h.land] : SEA;
    hexLayer += `<polygon data-id="${h.id}" points="${points(pts)}" fill="${fill}"/>`;
    if (h.land && h.sea) {
      // Coastal hexes: a small wave mark keeps "part land, part sea" visible.
      hexLayer += `<path d="M${fmt(cx - 4)},${fmt(cy + 4)} q2,-1.5 4,0 t4,0" class="wave"/>`;
    }
    frontLayer += `<polygon points="${points(pts)}" fill="${FRONT_TINT[h.front]}"/>`;
    cityLayer += citySymbol(h, cx, cy);
  }
  let rivers = "", borders = "", fronts = "", arrows = "", blocked = "";
  for (const s of Object.values(map.hexsides)) {
    const [x1, y1, x2, y2] = sideSegment(s.id);
    const line = `x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"`;
    if (s.river) rivers += `<line ${line}/>`;
    if (s.nationalBoundary) borders += `<line ${line}/>`;
    if (s.frontBoundary) fronts += `<line ${line}/>`;
    if (s.qattara) blocked += `<line ${line}/>`;
    if (s.crossingArrow) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      arrows += `<circle cx="${fmt(mx)}" cy="${fmt(my)}" r="2.6"/>`;
    }
  }
  const pad = SIZE;
  const view = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  container.innerHTML = `
    <svg class="map" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" role="img" aria-label="Map of Europe">
      <g class="hexes">${hexLayer}</g>
      <g class="front-tint" style="display:${opts.showFronts ? "inline" : "none"}">${frontLayer}</g>
      <g class="rivers">${rivers}</g>
      <g class="borders">${borders}</g>
      <g class="fronts">${fronts}</g>
      <g class="blocked">${blocked}</g>
      <g class="arrows">${arrows}</g>
      <g class="cities">${cityLayer}</g>
      <polygon class="hover" points="" />
    </svg>`;
  const svg = container.querySelector("svg")!;
  const hover = svg.querySelector<SVGPolygonElement>("polygon.hover")!;
  const tint = svg.querySelector<SVGGElement>("g.front-tint")!;

  // Pan and zoom by rewriting the viewBox. Pointer events cover mouse and touch.
  const vb = { ...view };
  const apply = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const toMap = (clientX: number, clientY: number) => {
    const r = svg.getBoundingClientRect();
    return [vb.x + ((clientX - r.left) / r.width) * vb.w, vb.y + ((clientY - r.top) / r.height) * vb.h] as const;
  };
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const [mx, my] = toMap(clientX, clientY);
    const w = Math.min(view.w * 1.2, Math.max(view.w / 12, vb.w * factor));
    const k = w / vb.w;
    vb.x = mx - (mx - vb.x) * k; vb.y = my - (my - vb.y) * k; vb.w = w; vb.h *= k;
    apply();
  };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  svg.addEventListener("pointerdown", (e) => { svg.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  const end = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 1) {
      const r = svg.getBoundingClientRect();
      vb.x -= ((e.clientX - prev.x) / r.width) * vb.w;
      vb.y -= ((e.clientY - prev.y) / r.height) * vb.h;
      apply();
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch / d);
      pinch = d;
    }
  });
  svg.addEventListener("mouseover", (e) => {
    const id = (e.target as Element).getAttribute?.("data-id");
    const h = id ? map.hexes[id] ?? null : null;
    if (h) {
      const [cx, cy] = hexCenter(hex(h.id));
      hover.setAttribute("points", points([0, 1, 2, 3, 4, 5].map((k) => corner(cx, cy, k))));
    }
    opts.onHover?.(h);
  });
  return { setFronts: (on) => { tint.style.display = on ? "inline" : "none"; } };
}
