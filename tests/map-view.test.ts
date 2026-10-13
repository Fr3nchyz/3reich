import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { baysBetweenLand, hexCenter } from "../src/ui/mapView";
import { hex } from "../src/engine/hex";

const towards = (from: string) => baysBetweenLand(MAP).filter((b) => b.hex === from).map((b) => b.toward).sort();

describe("water between land hexes that touch across the sea", () => {
  // The original draws these coastlines inside the hexes (checked against the map scan), so the hexes
  // touch; the viewer has to show the water or England looks joined to France.
  it("shows the English Channel between Britain and France", () => {
    expect(towards("L23")).toEqual(expect.arrayContaining(["L24", "M23"])); // Kent's coast faces Calais and Dieppe
    expect(towards("L24")).toContain("L23");
    expect(towards("M21")).toContain("L22"); // Cherbourg faces Southampton
    expect(MAP.hexes["L24"]!.name).toBe("Calais");
    expect(MAP.hexes["M21"]!.name).toBe("Cherbourg");
  });

  it("shows the Danish straits between Denmark and Sweden", () => {
    expect(MAP.hexes["I32"]!.name).toBe("Copenhagen");
    expect(towards("I32")).toEqual(expect.arrayContaining(["H33", "I33"]));
    expect(towards("I33")).toContain("I32");
  });

  it("cuts the water into both hexes, and only across sides that are ocean and nothing else", () => {
    const bays = baysBetweenLand(MAP);
    const key = (b: { hex: string; toward: string }) => `${b.hex}>${b.toward}`;
    const all = new Set(bays.map(key));
    for (const b of bays) {
      expect(all.has(`${b.toward}>${b.hex}`), `${key(b)} has no mirror`).toBe(true);
      expect(MAP.hexes[b.hex]!.land && MAP.hexes[b.toward]!.land).toBeTruthy();
    }
    // Every land-to-land ocean side is covered, both ways, and no other side is.
    const expected = Object.values(MAP.hexsides).filter((s) => s.sea && !s.land && s.id.split("-").every((h) => MAP.hexes[h]?.land)).length * 2;
    expect(bays).toHaveLength(expected);
    expect(expected).toBeGreaterThan(100);
    // Land hexes joined by land (Poland and Germany) get no water.
    expect(towards("M35").filter((h) => MAP.hexes[h]!.country === "poland")).toEqual([]);
  });

  it("keeps each notch inside its own hex, between the side and the centre", () => {
    for (const b of baysBetweenLand(MAP)) {
      const [cx, cy] = hexCenter(hex(b.hex));
      const [, , apex] = b.points;
      const [x1, y1] = b.points[0]!;
      const [x2, y2] = b.points[1]!;
      const mid = [(x1 + x2) / 2, (y1 + y2) / 2];
      const dApex = Math.hypot(apex![0] - cx, apex![1] - cy);
      const dMid = Math.hypot(mid[0]! - cx, mid[1]! - cy);
      expect(dApex).toBeLessThan(dMid);
      expect(dApex).toBeGreaterThan(0);
    }
  });
});
