import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { OWNER_NAMES } from "../src/engine/nations";
import type { ForceOwner, Unit, UnitType } from "../src/engine/types";
import { unitsWhere } from "../src/ui/actionLabels";
import { nationAdjective, placeName, stackSummary, unitName, unitsWithIds } from "../src/ui/names";
import { CTX } from "./helpers";

/** Plain names for places and counters (spec 07, part B and decisions 7 and 8): place first with the coordinate in brackets, no raw ids. */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, movement: number | undefined, at: string, nationality?: ForceOwner): Unit => ({
  id,
  owner,
  type,
  strength,
  at,
  ...(movement === undefined ? {} : { movement }),
  ...(nationality ? { nationality } : {}),
});

describe("placeName", () => {
  it("puts the place name first and the coordinate in brackets", () => {
    expect(placeName(MAP, "M35")).toBe("Warsaw (M35)");
    expect(placeName(MAP, "N33")).toBe("Lodz (N33)");
  });

  it("falls back to the coordinate when the hex has no printed name", () => {
    expect(MAP.hexes["M34"]?.name).toBeUndefined();
    expect(placeName(MAP, "M34")).toBe("M34");
  });

  it("falls back to the coordinate for a blank name and for an id the map does not know", () => {
    const map = { hexes: { A1: { ...MAP.hexes["M34"]!, id: "A1", name: "  " } }, hexsides: {} };
    expect(placeName(map, "A1")).toBe("A1");
    expect(placeName(MAP, "ZZ99")).toBe("ZZ99");
  });

  it("names the off-map boxes", () => {
    expect(placeName(MAP, "us-box")).toBe("US Box");
    expect(placeName(MAP, "murmansk-box")).toBe("Murmansk Box");
  });

  it("gives every named hex of the map as 'Name (id)' and never throws", () => {
    for (const h of Object.values(MAP.hexes)) expect(placeName(MAP, h.id)).toBe(h.name ? `${h.name} (${h.id})` : h.id);
  });
});

describe("unitName", () => {
  it("tells a ground counter as factors, nation and kind", () => {
    expect(unitName(unit("u94", "germany", "armor", 3, 4, "N33"))).toBe("3-4 German armor");
    expect(unitName(unit("u1", "poland", "infantry", 1, 3, "M35"))).toBe("1-3 Polish infantry");
  });

  it("prints a counter with a single factor (a fleet, a replacement) as that one number", () => {
    expect(unitName(unit("u2", "britain", "fleet", 3, undefined, "us-box"))).toBe("3 British fleet");
    expect(unitName(unit("u3", "ussr", "replacement", 1, undefined, "A1"))).toBe("1 Soviet replacement");
  });

  it("names the nation of the counter before its owner", () => {
    const italianFleetHeldByGermany = unit("u4", "germany", "fleet", 2, undefined, "A1", "italy");
    expect(unitName(italianFleetHeldByGermany)).toBe("2 Italian fleet");
    expect(unitName(italianFleetHeldByGermany, true)).toBe("2 Italian fleet, held by Germany");
    // Held by its own nation, or asked without 'held', says nothing about an owner.
    expect(unitName(unit("u5", "germany", "fleet", 2, undefined, "A1", "germany"), true)).toBe("2 German fleet");
  });

  it("has a word for every nation and every owner name", () => {
    for (const owner of Object.keys(OWNER_NAMES) as ForceOwner[]) {
      expect(nationAdjective({ owner })).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)?$/);
    }
    expect(nationAdjective({ owner: "ussr" })).toBe("Soviet");
    expect(nationAdjective({ owner: "vichy-france" })).toBe("Vichy French");
  });

  it("never contains the unit's id", () => {
    expect(unitName(unit("u94", "germany", "armor", 3, 4, "N33"))).not.toMatch(/\bu\d+\b/);
  });
});

describe("stackSummary", () => {
  it("is one counter's name for one counter", () => {
    expect(stackSummary([unit("u1", "germany", "armor", 3, 4, "N33")])).toBe("3-4 German armor");
  });

  it("counts identical counters and lists the different ones, in the order they first appear", () => {
    const stack = [
      unit("u1", "germany", "infantry", 3, 4, "N33"),
      unit("u2", "germany", "armor", 3, 4, "N33"),
      unit("u3", "germany", "infantry", 3, 4, "N33"),
      unit("u4", "germany", "air", 2, 6, "N33"),
    ];
    expect(stackSummary(stack)).toBe("2 x 3-4 German infantry, 3-4 German armor, 2-6 German air");
  });

  it("keeps counters of different nations apart, and says who holds a borrowed one when asked", () => {
    const mixed = [unit("u1", "britain", "infantry", 2, 3, "B1"), unit("u2", "france", "infantry", 2, 3, "B1"), unit("u3", "germany", "fleet", 2, undefined, "B1", "italy")];
    expect(stackSummary(mixed)).toBe("2-3 British infantry, 2-3 French infantry, 2 Italian fleet");
    expect(stackSummary(mixed, true)).toContain("2 Italian fleet, held by Germany");
  });

  it("says 'no units' for an empty list", () => {
    expect(stackSummary([])).toBe("no units");
  });
});

describe("unitsWhere", () => {
  const state = {
    units: {
      u94: unit("u94", "germany", "armor", 3, 4, "N33"),
      u95: unit("u95", "germany", "infantry", 2, 3, "N33"),
      u96: unit("u96", "germany", "infantry", 2, 3, "M34"),
    },
  };

  it("tells where one stack stands, by name", () => {
    expect(unitsWhere(CTX, state, ["u94"])).toBe("3-4 German armor from Lodz (N33)");
  });

  it("tells a stack from an unnamed hex by its coordinate", () => {
    expect(unitsWhere(CTX, state, ["u96"])).toBe("2-3 German infantry from M34");
  });

  it("tells counters from several hexes hex by hex", () => {
    expect(unitsWhere(CTX, state, ["u94", "u95", "u96"])).toBe("3-4 German armor, 2-3 German infantry from Lodz (N33) and 2-3 German infantry from M34");
  });

  it("leaves out an id that is not in the game instead of printing it", () => {
    expect(unitsWithIds(state, ["u94", "u999"]).map((u) => u.id)).toEqual(["u94"]);
    expect(unitsWhere(CTX, state, ["u999"])).toBe("no units");
    expect(unitsWhere(CTX, state, ["u94", "u999"])).not.toContain("u999");
  });
});
