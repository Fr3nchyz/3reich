import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import type { UnitType } from "../src/engine/types";
import { buildHexLayers } from "../src/ui/mapLayers";
import { COUNTRY_TINT, SEA, counterNumber, darken, landFill } from "../src/ui/mapStyle";
import { unitSymbol } from "../src/ui/mapSymbols";

/** The printed-board look: country tints, terrain marks, counter symbols. */

describe("country tints", () => {
  it("every country on the map has its own tint, so none falls back to the grey", () => {
    const countries = new Set(Object.values(MAP.hexes).flatMap((h) => (h.land && h.country ? [h.country] : [])));
    expect([...countries].filter((c) => !COUNTRY_TINT[c])).toEqual([]);
    expect(landFill("germany", "plain")).toBe(COUNTRY_TINT["germany"]);
    expect(landFill(undefined, "plain")).toBe("#e0dccd");
  });

  it("the land hexes are drawn in their country's tint, the sea in the sea colour, and mountains get a mark", () => {
    const { hexes } = buildHexLayers(MAP);
    expect(MAP.hexes["L31"]!.country).toBe("germany");
    expect(hexes).toMatch(new RegExp(`data-id="L31"[^>]*fill="${COUNTRY_TINT["germany"]}"`));
    const sea = Object.values(MAP.hexes).find((h) => !h.land)!;
    expect(hexes).toMatch(new RegExp(`data-id="${sea.id}"[^>]*fill="${SEA}" class="sea"`));
    const count = (terrain: string) => Object.values(MAP.hexes).filter((h) => h.land === terrain).length;
    expect(hexes.match(/class="terrain"/g)).toHaveLength(count("mountains"));
    expect(hexes.match(/class="terrain swamp"/g)).toHaveLength(count("swamp"));
  });

  it("the Qattara Depression has its own sandy colour", () => {
    expect(landFill("egypt", "qattara-depression")).toBe("#d9c58c");
  });
});

describe("counters", () => {
  it("darken mixes towards black", () => {
    expect(darken("#ffffff", 0)).toBe("#ffffff");
    expect(darken("#ffffff", 1)).toBe("#000000");
    expect(darken("#c8641e", 0.5)).toBe("#64320f");
  });

  it("print the strength, and the movement for ground and air units", () => {
    expect(counterNumber({ strength: 4, movement: 6 })).toBe("4-6");
    expect(counterNumber({ strength: 9 })).toBe("9");
  });

  it("have a symbol of their own for every type of unit", () => {
    const types: UnitType[] = ["infantry", "armor", "airborne", "replacement", "air", "fleet", "airbase", "bridgehead"];
    const drawn = types.map((t) => unitSymbol(t, 10, 10, 11, "#000"));
    expect(new Set(drawn).size).toBe(types.length);
    for (const d of drawn) expect(d.length).toBeGreaterThan(30);
  });
});
