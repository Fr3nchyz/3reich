import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { hex } from "../src/engine/hex";
import { BAY_DEPTH, SIZE, baysBetweenLand, cornersOf, hexCenter, hexCorners, midpoint, sideSegment } from "../src/ui/mapGeometry";
import { highlightsMarkup, unitsMarkup } from "../src/ui/mapCounters";
import { counterLabel } from "../src/ui/mapStyle";
import { buildBays, buildHexLayers, buildSideLayers } from "../src/ui/mapLayers";
import type { Unit } from "../src/engine/types";

describe("hex geometry", () => {
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

  it("labels a counter with its type mark, strength and movement", () => {
    expect(counterLabel({ type: "infantry", strength: 3, movement: 4 })).toBe("3-4");
    expect(counterLabel({ type: "fleet", strength: 9, movement: undefined })).toBe("⚓9");
  });

  it("draws at most four counters of a stack and counts the rest", () => {
    const at = Object.keys(MAP.hexes)[0]!;
    const six = Array.from({ length: 6 }, (_, i) => unit(`u${i}`, at));
    const out = unitsMarkup(MAP, six);
    expect(out.match(/<rect /g)).toHaveLength(4);
    expect(out).toContain(">+2<");
  });

  it("leaves off-map boxes and unknown hexes out", () => {
    expect(unitsMarkup(MAP, [unit("u1", "us-box")])).toBe("");
    expect(highlightsMarkup(MAP, ["us-box", "nowhere"])).toBe("");
    const id = Object.keys(MAP.hexes)[0]!;
    expect(highlightsMarkup(MAP, [id])).toContain(`data-hl="${id}"`);
  });
});
