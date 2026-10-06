import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { newGame, turnIndex } from "../src/engine/game";
import { MINOR_COUNTRY_FORCES } from "../src/engine/tables";
import type { Area, ForceEntry, ForceOwner } from "../src/engine/types";

const owners = Object.keys(SCENARIO_1939.forces) as ForceOwner[];
const mapCountries = new Set(Object.values(MAP.hexes).flatMap((h) => (h.country ? [h.country] : [])));
const hexesOf = (country: string) => Object.values(MAP.hexes).filter((h) => h.country === country);

const key = (e: Pick<ForceEntry, "type" | "strength">) => `${e.type}:${e.strength}`;
const poolCount = (entries: ForceEntry[]) => {
  const out = new Map<string, number>();
  for (const e of entries) out.set(key(e), (out.get(key(e)) ?? 0) + e.count);
  return out;
};

function areaProblems(area: Area): string[] {
  if ("country" in area) return area.country === "usa" || mapCountries.has(area.country) ? [] : [`unknown country ${area.country}`];
  if ("hex" in area) {
    const h = MAP.hexes[area.hex];
    return h && h.land ? [] : [`hex ${area.hex} is not a land hex`];
  }
  if ("ports" in area) {
    const any = Object.values(MAP.hexes).some((h) => h.front === area.ports && h.features.some((f) => f === "port" || f === "capital-port"));
    return any ? [] : [`no ports on the ${area.ports} front`];
  }
  return [];
}

describe("1939 scenario data (Ops 9.0, pp. 20-21)", () => {
  it("covers the six Major Powers and Poland, deploying in the printed order", () => {
    expect([...owners].sort()).toEqual(["britain", "france", "germany", "italy", "poland", "usa", "ussr"]);
    expect(SCENARIO_1939.deploymentOrder).toEqual(["poland", "italy", "france", "britain", "ussr", "germany"]);
    // The USA sets up in Spring '42, so it is not in the opening deployment.
    expect(SCENARIO_1939.deploymentOrder).not.toContain("usa");
  });

  it("starts with Germany at war with Poland, France and Britain", () => {
    expect(SCENARIO_1939.warsAtStart).toEqual([["germany", "poland"], ["germany", "france"], ["germany", "britain"]]);
  });

  it("has well-formed counters", () => {
    for (const owner of owners) {
      const { forcePool, allowableBuilds } = SCENARIO_1939.forces[owner];
      for (const e of [...forcePool, ...allowableBuilds]) {
        expect(Number.isInteger(e.count) && e.count > 0, `${owner} ${key(e)} count`).toBe(true);
        expect(Number.isInteger(e.strength) && e.strength > 0, `${owner} ${key(e)} strength`).toBe(true);
        if (e.type === "fleet" || e.type === "replacement") {
          expect(e.movement, `${owner} ${key(e)} has no movement factor`).toBeUndefined();
        } else {
          expect(Number.isInteger(e.movement) && e.movement! > 0, `${owner} ${key(e)} movement`).toBe(true);
        }
      }
    }
    // Every fleet counter in the scenario is the 9-factor fleet.
    const fleets = owners.flatMap((o) => SCENARIO_1939.forces[o].forcePool.filter((e) => e.type === "fleet"));
    expect(fleets.every((e) => e.strength === 9)).toBe(true);
  });

  it("matches the printed force pools and builds, nation by nation", () => {
    const summary = (o: ForceOwner) => ({
      pool: [...poolCount(SCENARIO_1939.forces[o].forcePool)].map(([k, n]) => `${k}x${n}`).sort(),
      builds: [...poolCount(SCENARIO_1939.forces[o].allowableBuilds)].map(([k, n]) => `${k}x${n}`).sort(),
    });
    expect(summary("poland")).toEqual({ pool: ["air:1x2", "infantry:1x7", "infantry:2x3"], builds: [] });
    expect(summary("germany")).toEqual({
      pool: ["air:5x4", "armor:4x4", "fleet:9x2", "infantry:3x8"],
      builds: ["air:5x2", "airborne:3x1", "armor:4x8", "fleet:9x2", "infantry:3x20", "replacement:1x8"],
    });
    expect(summary("usa")).toEqual({ pool: ["air:5x2", "armor:5x1", "fleet:9x4", "infantry:3x10"], builds: [] });
    // Spot totals read straight off the page: Britain's pool is 3+3+1+1+6+2+4 counters,
    // the USSR's is 12+5+3+3+2, Italy's 2+6+1+4+2, France's 12+1+3+2+2.
    const total = (o: ForceOwner) => SCENARIO_1939.forces[o].forcePool.reduce((n, e) => n + e.count, 0);
    expect([total("britain"), total("ussr"), total("italy"), total("france")]).toEqual([20, 25, 15, 20]);
  });

  it("gives Poland the same forces as the Minor Country Forces chart (a separate page of the manual)", () => {
    const chart = MINOR_COUNTRY_FORCES.poland;
    const pool = poolCount(SCENARIO_1939.forces.poland.forcePool);
    expect(pool.get("infantry:1")).toBe(chart.inf1_3);
    expect(pool.get("infantry:2")).toBe(chart.inf2_3);
    expect(pool.get("air:1")).toBe(chart.air1_4);
  });

  it("only controls real countries, and no country has two owners", () => {
    const seen = new Map<string, ForceOwner>();
    for (const owner of owners) {
      for (const c of SCENARIO_1939.forces[owner].controlledAtStart) {
        expect(c === "usa" || mapCountries.has(c), `${owner}: ${c} is on the map`).toBe(true);
        expect(seen.get(c), `${c} is controlled by both ${seen.get(c)} and ${owner}`).toBeUndefined();
        seen.set(c, owner);
      }
    }
    // The territories named on the page, including those that are islands within a country on the map.
    const ctrl = (o: ForceOwner) => SCENARIO_1939.forces[o].controlledAtStart;
    expect(ctrl("italy")).toEqual(["italy", "albania", "libya"]);
    expect(ctrl("britain")).toEqual(["britain", "egypt", "iraq", "palestine", "transjordan"]);
    expect(ctrl("france")).toEqual(["france", "algeria", "morocco", "tunisia", "lebanon-syria"]);
    const nameOf = (hex: string) => MAP.hexes[hex]?.name;
    const countryOf = (name: string) => Object.values(MAP.hexes).find((h) => h.name === name)?.country;
    // Malta, Gibraltar and Cyprus (Famagusta) are British; Corsica (Ajaccio) French; Sardinia, Sicily, Rhodes Italian.
    expect(["Malta", "Gibraltar", "Famagusta"].map(countryOf)).toEqual(["britain", "britain", "britain"]);
    expect(countryOf("Ajaccio")).toBe("france");
    expect(["Cagliari", "Messina"].map(countryOf)).toEqual(["italy", "italy"]);
    expect(nameOf("GG19")).toBe("Malta");
  });

  it("refers only to areas that exist on the map", () => {
    for (const owner of owners) {
      for (const r of SCENARIO_1939.forces[owner].setup) {
        const areas = r.kind === "min-factors" ? [] : r.kind === "max-factors" ? [r.area] : r.in;
        for (const a of areas) expect(areaProblems(a), `${owner} ${JSON.stringify(r)}`).toEqual([]);
      }
    }
  });

  it("puts the Soviet setup units on the cities the page names", () => {
    const hexOfCity = (name: string) => Object.values(MAP.hexes).find((h) => h.name === name)?.id;
    const placed = SCENARIO_1939.forces.ussr.setup.flatMap((r) => (r.kind === "place" && "hex" in r.in[0]! ? [[r.type, r.strength, r.in[0].hex] as const] : []));
    expect(placed).toEqual([
      ["infantry", 2, hexOfCity("Leningrad")],
      ["armor", 3, hexOfCity("Moscow")],
      ["infantry", 1, hexOfCity("Odessa")],
      ["infantry", 1, hexOfCity("Kharkov")],
      ["infantry", 1, hexOfCity("Grozny")],
    ]);
    expect(hexOfCity("Gibraltar")).toBe("AA7");
  });

  it("never asks to set up more counters of a kind than the force pool holds", () => {
    for (const owner of owners) {
      const pool = poolCount(SCENARIO_1939.forces[owner].forcePool);
      const need = new Map<string, number>();
      for (const r of SCENARIO_1939.forces[owner].setup) {
        if (r.kind === "place") need.set(`${r.type}:${r.strength}`, (need.get(`${r.type}:${r.strength}`) ?? 0) + r.count);
      }
      for (const [k, n] of need) expect(n, `${owner} needs ${n} of ${k}`).toBeLessThanOrEqual(pool.get(k) ?? 0);
    }
  });

  it("keeps Germany's 20 Eastern Front factors within what Germany can field", () => {
    const g = SCENARIO_1939.forces.germany;
    const factors = g.forcePool.filter((e) => e.type === "infantry" || e.type === "armor" || e.type === "air").reduce((n, e) => n + e.strength * e.count, 0);
    const min = g.setup.find((r) => r.kind === "min-factors");
    expect(min).toMatchObject({ front: "eastern", min: 20 });
    expect(factors).toBeGreaterThan(20);
  });

  it("has scenario rules that fall inside the scenario's dates", () => {
    const first = turnIndex(SCENARIO_1939.start), last = turnIndex(SCENARIO_1939.end);
    for (const r of SCENARIO_1939.rules) {
      if (r.kind === "no-brp-growth") expect(r.year).toBe(1940);
      else {
        expect(turnIndex(r.turn)).toBeGreaterThanOrEqual(first);
        expect(turnIndex(r.turn)).toBeLessThanOrEqual(last);
      }
    }
    expect(SCENARIO_1939.rules).toContainEqual({
      kind: "automatic-declaration", by: "usa", on: "germany", turn: { year: 1942, season: "spring" }, side: "allies", brpCost: 35,
    });
    // Summer '42 is the final turn of the scenario.
    expect(SCENARIO_1939.end).toEqual({ year: 1942, season: "summer" });
  });
});

describe("starting a game from the scenario", () => {
  it("copies the pools and wars into the game state without sharing them", () => {
    const s = newGame(SCENARIO_1939, 1);
    expect(s.pools.germany.forcePool).toEqual(SCENARIO_1939.forces.germany.forcePool);
    expect(s.wars).toEqual(SCENARIO_1939.warsAtStart);
    s.pools.germany.forcePool[0]!.count = 0;
    s.pools.poland.allowableBuilds.push({ type: "infantry", strength: 1, movement: 3, count: 1 });
    s.wars.push(["italy", "britain"]);
    expect(SCENARIO_1939.forces.germany.forcePool[0]!.count).toBe(8);
    expect(SCENARIO_1939.forces.poland.allowableBuilds).toEqual([]);
    expect(SCENARIO_1939.warsAtStart).toHaveLength(3);
  });

  it("survives a JSON round trip, scenario and state alike", () => {
    expect(JSON.parse(JSON.stringify(SCENARIO_1939))).toStrictEqual(SCENARIO_1939);
    const s = newGame(SCENARIO_1939, 7);
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
  });
});
