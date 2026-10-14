import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import type { MapData } from "../src/engine/map";
import { buildSideLayers, svgMarkup, buildHexLayers } from "../src/ui/mapLayers";
import { isWaterEdge, paintedWaterEdges, waterEdgePath, waterEdges } from "../src/ui/waterEdges";

/** Water edges: hexsides between two land hexes that ground units cannot cross are drawn as water (drawing only). */

const ids = new Set(waterEdges(MAP).map((s) => s.id));

describe("which hexsides are water edges", () => {
  it("finds the 226 land-to-land hexsides that are not land-crossable in the map data", () => {
    expect(waterEdges(MAP)).toHaveLength(226);
  });

  it("includes the straits and channels that make land hexes look joined", () => {
    for (const id of ["AA25-AA26", "K24-L24", "L22-M21", "AA7-BB6", "U26-V26"]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(MAP.hexes["AA25"]!.name).toBe("Brindisi"); // Otranto: Italy and Albania
    expect(MAP.hexes["AA26"]!.name).toBe("Durazzo");
    expect(MAP.hexes["K24"]!.name).toBe("Harwich"); // the Channel
    expect(MAP.hexes["L24"]!.name).toBe("Calais");
    expect(MAP.hexes["U26"]!.name).toBe("Trieste");
  });

  it("includes a crossing-arrow hexside (Messina): it is crossed by sea, and still drawn as water", () => {
    expect(ids.has("DD21-DD22")).toBe(true);
    expect(MAP.hexsides["DD21-DD22"]!.crossingArrow).toBe(true);
  });

  it("is never a land-crossable hexside, and never one with a sea hex on either side", () => {
    for (const s of waterEdges(MAP)) {
      expect(s.land).toBe(false);
      for (const h of s.id.split("-")) expect(MAP.hexes[h]!.land).toBeTruthy();
    }
    const dry = Object.values(MAP.hexsides).find((s) => s.land)!;
    expect(isWaterEdge(MAP, dry)).toBe(false);
    const sea = Object.values(MAP.hexsides).find((s) => s.id.split("-").some((h) => !MAP.hexes[h]!.land))!;
    expect(isWaterEdge(MAP, sea)).toBe(false);
  });

  it("paints all but the Qattara Depression's dry sides", () => {
    const qattara = waterEdges(MAP).filter((s) => s.qattara);
    expect(qattara).toHaveLength(4);
    expect(paintedWaterEdges(MAP)).toHaveLength(222);
    expect(waterEdgePath(MAP).match(/M/g)).toHaveLength(222);
  });
});

describe("the water layer in the map", () => {
  const svg = svgMarkup(MAP, { x: 0, y: 0, w: 100, h: 100 }, false, buildHexLayers(MAP));

  it("is two paths in all (the band and the ripple along it), under the counters and above the hexes", () => {
    const layer = /<g class="wateredges"[^>]*>(.*?)<\/g>/.exec(svg)![1]!;
    expect(layer.match(/<path /g)).toHaveLength(2);
    expect(svg.indexOf('class="hexes"')).toBeLessThan(svg.indexOf('class="wateredges"'));
    expect(svg.indexOf('class="wateredges"')).toBeLessThan(svg.indexOf('class="units"'));
    expect(svg.indexOf('class="wateredges"')).toBeLessThan(svg.indexOf('class="overlay"')); // the control overlay stays on top
    expect(svg.indexOf('class="wateredges"')).toBeLessThan(svg.indexOf('class="arrows"')); // arrows stay readable
  });

  it("leaves the crossing arrows and the rivers as they were", () => {
    const sides = buildSideLayers(MAP);
    expect(sides.arrows.match(/<circle /g)).toHaveLength(Object.values(MAP.hexsides).filter((s) => s.crossingArrow).length);
    expect(sides.rivers.match(/<line /g)).toHaveLength(Object.values(MAP.hexsides).filter((s) => s.river).length);
  });

  it("draws the heavy brown national boundary only on land-crossable sides", () => {
    const withBorder: MapData = { ...MAP, hexsides: { ...MAP.hexsides, "AA25-AA26": { ...MAP.hexsides["AA25-AA26"]!, nationalBoundary: true } } };
    const before = buildSideLayers(MAP).borders.match(/<line /g)!.length;
    expect(buildSideLayers(withBorder).borders.match(/<line /g)!.length, "a boundary on a water edge adds no brown line").toBe(before);
    // And the real boundaries are still there.
    expect(before).toBe(Object.values(MAP.hexsides).filter((s) => s.nationalBoundary).length);
  });
});
