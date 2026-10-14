import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { MAP } from "../src/data/map";
import { territoryOf } from "../src/engine/areas";
import { areEnemies, controlAfterEntry, controlMap, controllerOf, controllingSide, enterHexes, sideInWar, startingControl } from "../src/engine/control";
import type { ForceOwner } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Ref 7.0 (control of hexes), 16.0 (conquest of minors); the start is the scenario's "controlled at start" (Ops 9.0).
describe("control at the start", () => {
  it("every hex of a start territory belongs to its owner, and no hex to two owners (Ops 9.0)", () => {
    for (const ctx of [CTX, ctxFor(SCENARIO_1942)]) {
      const seen = new Map<string, ForceOwner>();
      for (const owner of Object.keys(ctx.scenario.forces) as ForceOwner[]) {
        for (const h of territoryOf(ctx, owner).places) {
          if (!ctx.map.hexes[h]?.land) continue;
          expect(seen.has(h), `${h} claimed twice`).toBe(false);
          seen.set(h, owner);
          expect(controllerOf(ctx, board([], ctx.scenario), h)).toBe(owner);
        }
      }
      expect(startingControl(ctx).size).toBe(seen.size);
    }
  });

  it("reads Berlin, Warsaw, Paris, London and Rome in 1939; neutral Brussels and the sea have no controller", () => {
    const s = board([]);
    expect(controllerOf(CTX, s, "L31")).toBe("germany");
    expect(controllerOf(CTX, s, "M35")).toBe("poland");
    expect(controllerOf(CTX, s, "O22")).toBe("france");
    expect(controllerOf(CTX, s, "K23")).toBe("britain");
    expect(controllerOf(CTX, s, "Y22")).toBe("italy");
    expect(controllerOf(CTX, s, "M25")).toBeNull();
    const sea = Object.values(MAP.hexes).find((h) => !h.land)!;
    expect(controllerOf(CTX, s, sea.id)).toBeNull();
  });

  it("reads the 1942 start: Warsaw is German, the Vichy zone is Vichy's", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([], SCENARIO_1942);
    expect(controllerOf(ctx, s, "M35")).toBe("germany");
    const vichy = [...startingControl(ctx)].filter(([, o]) => o === "vichy-france");
    expect(vichy.length).toBeGreaterThan(0);
    expect(controllingSide(ctx, s, vichy[0]![0])).toBeNull();
  });

  it("the overrides in the state win over the start", () => {
    const s = board([], undefined, { control: { M35: "germany" } });
    expect(controllerOf(CTX, s, "M35")).toBe("germany");
    expect(controlMap(CTX, s).get("M35")).toBe("germany");
    expect(controlMap(CTX, s).get("L31")).toBe("germany");
  });
});

describe("sides", () => {
  it("a neutral Major Power and Vichy France take no side; enemies follow the sides or the war record", () => {
    const s = board([]);
    expect(sideInWar(s, "germany")).toBe("axis");
    expect(sideInWar(s, "poland")).toBe("allies");
    expect(sideInWar(s, "italy")).toBeNull(); // neutral in 1939
    expect(sideInWar(s, "vichy-france")).toBeNull();
    expect(areEnemies(s, "germany", "france")).toBe(true);
    expect(areEnemies(s, "germany", "italy")).toBe(false);
    expect(areEnemies(s, "britain", "france")).toBe(false);
  });
});

describe("control changes when a ground unit enters (Ref 7.0)", () => {
  const infantry = counter("u1", "germany", "infantry", 3, "M34", 4);

  it("takes an enemy-controlled hex and logs it", () => {
    const s = board([infantry]);
    const r = enterHexes(CTX, s, infantry, ["M35"]);
    expect(controllerOf(CTX, r.state, "M35")).toBe("germany");
    expect(r.events).toEqual([{ type: "HEX_CONTROL_CHANGED", hex: "M35", from: "poland", to: "germany", unitId: "u1" }]);
    expect(s.control).toEqual({}); // the input state is not changed
  });

  it("changes nothing on a hex the owner or an ally already holds, or one entered a second time", () => {
    const s = board([infantry]);
    expect(enterHexes(CTX, s, infantry, ["L31"]).events).toEqual([]);
    const ally = counter("u2", "britain", "infantry", 2, "O22", 3);
    expect(enterHexes(CTX, s, ally, ["O22"]).events).toEqual([]);
    const once = enterHexes(CTX, s, infantry, ["M35"]);
    expect(enterHexes(CTX, once.state, infantry, ["M35"]).events).toEqual([]);
  });

  it("takes every hex a unit passes through, in order", () => {
    const s = board([infantry]);
    const r = enterHexes(CTX, s, infantry, ["M35", "M36"]);
    expect(r.events.map((e) => (e.type === "HEX_CONTROL_CHANGED" ? e.hex : null))).toEqual(["M35", "M36"]);
  });

  it("only infantry, armor and airborne take hexes; not air, fleets, replacements or the sea", () => {
    const s = board([]);
    for (const type of ["air", "fleet", "replacement", "airbase", "bridgehead"] as const) {
      expect(controlAfterEntry(CTX, s, { owner: "germany", type }, "M35"), type).toBeNull();
    }
    for (const type of ["infantry", "armor", "airborne"] as const) expect(controlAfterEntry(CTX, s, { owner: "germany", type }, "M35"), type).toBe("germany");
    const sea = Object.values(MAP.hexes).find((h) => !h.land)!;
    expect(controlAfterEntry(CTX, s, { owner: "germany", type: "infantry" }, sea.id)).toBeNull();
  });

  it("a neutral Major Power's hex changes hands only once the two are at war", () => {
    const s = board([]);
    const british = { owner: "britain" as const, type: "infantry" as const };
    expect(controlAfterEntry(CTX, s, british, "Y22")).toBeNull();
    const war = { ...s, wars: [...s.wars, ["britain", "italy"] as ["britain", "italy"]], nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" as const } } };
    expect(controlAfterEntry(CTX, war, british, "Y22")).toBe("britain");
  });

  it("a neutral minor country's hex is taken only once it is at war with the unit's owner (Ref 16.0, TODO verify)", () => {
    const s = board([]);
    const german = { owner: "germany" as const, type: "infantry" as const };
    expect(controllerOf(CTX, s, "M25")).toBeNull();
    expect(controlAfterEntry(CTX, s, german, "M25")).toBeNull();
    const war = { ...s, wars: [...s.wars, ["germany", "belgium"] as ["germany", "belgium"]] };
    const r = enterHexes(CTX, war, counter("u1", "germany", "infantry", 3, "M25"), ["M25"]);
    expect(r.events).toEqual([{ type: "HEX_CONTROL_CHANGED", hex: "M25", from: null, to: "germany", unitId: "u1" }]);
  });

  it("the USSR retakes a hex Germany holds (1942)", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([], SCENARIO_1942);
    expect(controlAfterEntry(ctx, s, { owner: "ussr", type: "armor" }, "M35")).toBe("ussr");
  });
});
