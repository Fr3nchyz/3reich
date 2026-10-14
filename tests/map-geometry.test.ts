import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { hex } from "../src/engine/hex";
import { BAY_DEPTH, FORTRESS_INSET, SIZE, baysBetweenLand, cornersOf, hexCenter, hexCorners, midpoint, sideSegment } from "../src/ui/mapGeometry";
import { highlightsMarkup, unitsMarkup } from "../src/ui/mapCounters";
import { citySymbol } from "../src/ui/mapCities";
import { buildBays, buildHexLayers, buildSideLayers } from "../src/ui/mapLayers";
import type { Unit } from "../src/engine/types";

describe("hex geometry", () => {
  // Fixed numbers worked out by hand from the formulas the map has always used (size 10, x = 10 * sqrt(3) * (q + r / 2), y = 15 * r),
  // so a change to the geometry cannot slip through by moving everything together.
  it("places hexes at known positions", () => {
    expect(SIZE).toBe(10);
    expect(BAY_DEPTH).toBe(0.62);
    expect(FORTRESS_INSET).toBe(0.78);
    const [x, y] = hexCenter(hex("L23")); // q = 23, r = 11
    expect(x).toBeCloseTo(493.63448, 4);
    expect(y).toBe(165);
    const [x2, y2] = hexCenter(hex("AA25")); // q = 25, r = 26
    expect(x2).toBeCloseTo(658.17931, 4);
    expect(y2).toBe(390);
  });

  it("puts the six corners one hex size from the centre, the first straight above it", () => {
    const [cx, cy] = hexCenter(hex("L23"));
    const corners = hexCorners(cx, cy);
    expect(corners).toHaveLength(6);
    for (const [x, y] of corners) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(SIZE, 9);
    expect(corners[0]![0]).toBeCloseTo(cx, 9);
    expect(corners[0]![1]).toBeCloseTo(cy - SIZE, 9);
    expect(cornersOf("L23")).toEqual(corners);
  });

  it("draws a hexside between the two corners the neighbours share", () => {
    const [x1, y1, x2, y2] = sideSegment("L23-L24");
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(SIZE, 9); // a side is as long as the hex size
    const mid = midpoint([x1, y1], [x2, y2]);
    const a = hexCenter(hex("L23")), b = hexCenter(hex("L24"));
    expect(mid[0]).toBeCloseTo((a[0] + b[0]) / 2, 9); // and cuts the line between the centres in half
    expect(mid[1]).toBeCloseTo((a[1] + b[1]) / 2, 9);
  });

  it("reaches into the hex by BAY_DEPTH by default and by the given depth otherwise", () => {
    const tipDistance = (depth?: number) => {
      const b = baysBetweenLand(MAP, depth)[0]!;
      const [cx, cy] = hexCenter(hex(b.hex));
      const mid = midpoint(b.points[0]!, b.points[1]!);
      return [Math.hypot(b.points[2]![0] - mid[0], b.points[2]![1] - mid[1]), Math.hypot(cx - mid[0], cy - mid[1])] as const;
    };
    const [reach, full] = tipDistance();
    expect(reach / full).toBeCloseTo(BAY_DEPTH, 9);
    const [half, full2] = tipDistance(0.5);
    expect(half / full2).toBeCloseTo(0.5, 9);
  });
});

describe("city symbols", () => {
  const fortress = { id: "L23", land: "plain", sea: false, features: [], fortress: "permanent", front: "western" } as const;

  it("draws a fortress outline 78 percent of the way to the corners", () => {
    const out = citySymbol(fortress, 100, 100);
    // The first corner is straight above the centre: 10 * 0.78 = 7.8 above it.
    expect(out).toContain('points="100.0,92.2 ');
    expect(out).toContain('stroke-dasharray="1.2 1"');
  });

  it("draws the name below the centre and marks an objective", () => {
    const out = citySymbol({ ...fortress, fortress: undefined, name: "Calais", features: ["city", "objective"] }, 100, 100);
    expect(out).toContain('<text x="100.0" y="107.2" class="city objective">Calais</text>');
    expect(out).toContain('r="1.8" fill="#b3202a"');
  });
});

describe("map layers", () => {
  it("draws one polygon per hex and bounds all of them", () => {
    const layers = buildHexLayers(MAP);
    expect(layers.hexes.match(/<polygon data-id=/g)).toHaveLength(Object.keys(MAP.hexes).length);
    expect(layers.bounds.w).toBeGreaterThan(0);
    expect(layers.bounds.h).toBeGreaterThan(0);
  });

  it("draws a notch and a grid line for every bay, and a line for every river side", () => {
    const bays = baysBetweenLand(MAP).length;
    const svg = buildBays(MAP);
    expect(svg.match(/<path /g)).toHaveLength(bays);
    expect(svg.match(/<line /g)).toHaveLength(bays);
    const sides = buildSideLayers(MAP);
    expect(sides.rivers.match(/<line /g)).toHaveLength(Object.values(MAP.hexsides).filter((s) => s.river).length);
  });
});

describe("counters on the map", () => {
  const unit = (id: string, at: string): Unit => ({ id, owner: "germany", type: "infantry", strength: 3, at, movement: 4 });

  it("draws a counter as cardboard in its nation's colour, with the unit symbol and the numbers", () => {
    const at = Object.keys(MAP.hexes)[0]!;
    const out = unitsMarkup(MAP, [{ id: "u1", owner: "germany", type: "armor", strength: 4, at, movement: 6 }]);
    expect(out).toContain('fill="#3a3340"'); // Germany's counter colour
    expect(out).toContain("<ellipse"); // the armor symbol
    expect(out).toContain(">4-6</text>");
    expect(unitsMarkup(MAP, [{ id: "u2", owner: "britain", type: "fleet", strength: 9, at }])).toContain(">9</text>");
  });

  it("draws at most four counters of a stack and counts the rest", () => {
    const at = Object.keys(MAP.hexes)[0]!;
    const six = Array.from({ length: 6 }, (_, i) => unit(`u${i}`, at));
    const out = unitsMarkup(MAP, six);
    expect(out.match(/<g data-at=/g)).toHaveLength(4);
    expect(out).toContain(">+2<");
  });

  it("leaves off-map boxes and unknown hexes out", () => {
    expect(unitsMarkup(MAP, [unit("u1", "us-box")])).toBe("");
    expect(highlightsMarkup(MAP, ["us-box", "nowhere"])).toBe("");
    const id = Object.keys(MAP.hexes)[0]!;
    expect(highlightsMarkup(MAP, [id])).toContain(`data-hl="${id}"`);
  });
});
