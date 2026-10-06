import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { newGame, nextTurn, setupOf, turnIndex } from "../src/engine/game";
import { hex, hexId, neighbors } from "../src/engine/hex";
import { MINOR_COUNTRY_FORCES } from "../src/engine/tables";
import type { Area, ForceEntry, ForceOwner, GameTurn, Scenario, SetupRequirement } from "../src/engine/types";

/** Each scenario with the number of Game Turns its page gives as the maximum. */
const ALL = [
  { id: "1939", s: SCENARIO_1939, maxTurns: 12 },
  { id: "1942", s: SCENARIO_1942, maxTurns: 12 },
  { id: "1944", s: SCENARIO_1944, maxTurns: 9 },
  { id: "campaign", s: SCENARIO_CAMPAIGN, maxTurns: 24 },
];

const hexes = Object.values(MAP.hexes);
const mapCountries = new Set(hexes.flatMap((h) => (h.country ? [h.country] : [])));
const landHexesOf = (country: string) => hexes.filter((h) => h.country === country && h.land).map((h) => h.id);
const ownersOf = (s: Scenario) => Object.keys(s.forces) as ForceOwner[];

const key = (e: Pick<ForceEntry, "type" | "strength">) => `${e.type}:${e.strength}`;
const total = (entries: ForceEntry[]) => {
  const out = new Map<string, number>();
  for (const e of entries) out.set(key(e), (out.get(key(e)) ?? 0) + e.count);
  return out;
};
const summary = (entries: ForceEntry[]) => [...total(entries)].map(([k, n]) => `${k}x${n}`).sort();
const countFor = (s: Scenario, o: ForceOwner) => {
  const f = setupOf(s, o);
  return total([...f.forcePool, ...f.allowableBuilds]);
};

function areasOf(r: SetupRequirement): Area[] {
  switch (r.kind) {
    case "place":
    case "all-in":
    case "rest-in":
      return r.in;
    case "max-factors":
      return [r.area];
    default:
      return [];
  }
}

function areaProblems(s: Scenario, area: Area): string[] {
  if ("country" in area) return area.country === "usa" || mapCountries.has(area.country) ? [] : [`unknown country ${area.country}`];
  if ("hex" in area) {
    const h = MAP.hexes[area.hex];
    return h && h.land ? [] : [`hex ${area.hex} is not a land hex`];
  }
  if ("ports" in area) {
    const any = hexes.some((h) => h.front === area.ports && h.features.some((f) => f === "port" || f === "capital-port"));
    return any ? [] : [`no ports on the ${area.ports} front`];
  }
  if ("front" in area) return hexes.some((h) => h.land && h.front === area.front) ? [] : [`no land on the ${area.front} front`];
  if ("zone" in area) return s.zones[area.zone] ? [] : [`unknown zone ${area.zone}`];
  if ("controlledBy" in area) return s.forces[area.controlledBy] ? [] : [`${area.controlledBy} has no forces in ${s.id}`];
  return [];
}

/**
 * Land hexes of one country that touch each other, starting from `start`. This follows hex
 * adjacency, not hexside types: the map marks hexes joined only along a coastline (such as
 * Cagliari and the rest of Sardinia) as not land-connected.
 */
function landComponent(start: string): Set<string> {
  const country = MAP.hexes[start]!.country;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.pop()!;
    for (const n of neighbors(hex(id))) {
      const nid = hexId(n);
      const h = MAP.hexes[nid];
      if (!h || !h.land || h.country !== country || seen.has(nid)) continue;
      seen.add(nid);
      queue.push(nid);
    }
  }
  return seen;
}

describe.each(ALL)("scenario data: $id", ({ s, maxTurns }) => {
  const owners = ownersOf(s);

  it("runs for the number of Game Turns the page states", () => {
    let t: GameTurn = s.start;
    let n = 1;
    while (turnIndex(t) < turnIndex(s.end)) {
      t = nextTurn(t);
      n++;
    }
    expect(n).toBe(maxTurns);
  });

  it("lists every owner with forces in the order of deployment, once", () => {
    expect(new Set(s.deploymentOrder).size).toBe(s.deploymentOrder.length);
    for (const o of s.deploymentOrder) expect(s.forces[o], `${o} deploys but has no forces`).toBeDefined();
    // The USA is the only owner that is not part of the opening deployment, and only while it is neutral.
    const missing = owners.filter((o) => !s.deploymentOrder.includes(o));
    expect(missing).toEqual(s.nations.usa.status === "neutral" ? ["usa"] : []);
  });

  it("has well-formed counters", () => {
    for (const owner of owners) {
      const { forcePool, allowableBuilds } = setupOf(s, owner);
      for (const e of forcePool) expect(e.from, `${owner} pool counter ${key(e)} has a build date`).toBeUndefined();
      for (const e of [...forcePool, ...allowableBuilds]) {
        expect(Number.isInteger(e.count) && e.count > 0, `${owner} ${key(e)} count`).toBe(true);
        expect(Number.isInteger(e.strength) && e.strength > 0, `${owner} ${key(e)} strength`).toBe(true);
        if (e.type === "fleet" || e.type === "replacement") {
          expect(e.movement, `${owner} ${key(e)} has no movement factor`).toBeUndefined();
        } else {
          expect(Number.isInteger(e.movement) && e.movement! > 0, `${owner} ${key(e)} movement`).toBe(true);
        }
        if (e.type === "replacement") expect(e.strength).toBe(1);
        // Every fleet counter is the 9-factor fleet, except the 6-factor Italian one in the German 1944 pool.
        if (e.type === "fleet" && e.nationality === undefined) expect(e.strength, `${owner} fleet`).toBe(9);
        if (e.from) {
          const t = turnIndex({ year: e.from.year, season: e.from.season ?? "spring" });
          expect(t, `${owner} ${key(e)} build date`).toBeGreaterThanOrEqual(turnIndex(s.start));
          expect(t, `${owner} ${key(e)} build date`).toBeLessThanOrEqual(turnIndex(s.end));
        }
      }
    }
  });

  it("only controls real countries, and no country or known hex has two owners", () => {
    const whole = new Map<string, ForceOwner>();
    for (const owner of owners) {
      for (const c of setupOf(s, owner).controlledAtStart) {
        expect(c === "usa" || mapCountries.has(c), `${owner}: ${c} is on the map`).toBe(true);
        expect(whole.get(c), `${c} is controlled by both ${whole.get(c)} and ${owner}`).toBeUndefined();
        whole.set(c, owner);
      }
    }
    const byHex = new Map<string, ForceOwner>();
    const claim = (h: string, owner: ForceOwner) => {
      expect(byHex.get(h), `${h} is controlled by both ${byHex.get(h)} and ${owner}`).toBeUndefined();
      byHex.set(h, owner);
    };
    for (const [c, owner] of whole) for (const h of landHexesOf(c)) claim(h, owner);
    const zoneOwner = new Map<string, ForceOwner>();
    for (const owner of owners) {
      for (const z of setupOf(s, owner).controlledZones) {
        expect(s.zones[z], `${owner}: zone ${z} is defined`).toBeDefined();
        expect(zoneOwner.get(z), `zone ${z} has two owners`).toBeUndefined();
        zoneOwner.set(z, owner);
        const zone = s.zones[z]!;
        // A zone with known hexes is checked hex by hex; one without may not sit inside a country another owner holds whole.
        if (zone.hexes) for (const h of zone.hexes) claim(h, owner);
        else for (const c of zone.countries) expect(whole.has(c), `${owner} holds part of ${c}, which ${whole.get(c)} holds whole`).toBe(false);
      }
    }
  });

  it("defines each zone sensibly, and uses every zone it defines", () => {
    const used = new Set<string>();
    for (const owner of owners) {
      const f = setupOf(s, owner);
      f.controlledZones.forEach((z) => used.add(z));
      for (const a of [...f.setup.flatMap(areasOf), ...f.mayAlsoSetUpIn.flatMap((p) => p.areas)]) if ("zone" in a) used.add(a.zone);
    }
    for (const r of s.rules) if (r.kind === "eliminate-in-zone") used.add(r.zone);
    expect([...used].sort()).toEqual(Object.keys(s.zones).sort());
    for (const [id, z] of Object.entries(s.zones)) {
      for (const c of z.countries) expect(mapCountries.has(c), `${id}: ${c} is on the map`).toBe(true);
      if (!z.hexes) continue;
      expect(z.hexes.length, `${id} has hexes`).toBeGreaterThan(0);
      expect(new Set(z.hexes).size, `${id} lists a hex twice`).toBe(z.hexes.length);
      for (const h of z.hexes) {
        const mh = MAP.hexes[h];
        expect(mh?.land && z.countries.includes(mh.country ?? ""), `${id}: ${h} is a land hex of ${z.countries.join("/")}`).toBeTruthy();
      }
    }
  });

  it("refers only to areas that exist on the map", () => {
    for (const owner of owners) {
      const f = setupOf(s, owner);
      for (const r of f.setup) for (const a of areasOf(r)) expect(areaProblems(s, a), `${owner} ${JSON.stringify(r)}`).toEqual([]);
      for (const p of f.mayAlsoSetUpIn) for (const a of p.areas) expect(areaProblems(s, a), `${owner} ${JSON.stringify(p)}`).toEqual([]);
      for (const r of f.setup) {
        if (r.kind === "min-factors") expect(r.min).toBeGreaterThan(0);
        if (r.kind === "max-factors") expect(r.max).toBeGreaterThan(0);
        if (r.kind === "min-ground-factors-near") for (const h of r.hexes) expect(MAP.hexes[h]?.land, `${owner}: ${h}`).toBeTruthy();
      }
    }
  });

  it("never asks to set up more counters than the force pool holds", () => {
    for (const owner of owners) {
      const f = setupOf(s, owner);
      const own = f.forcePool.filter((e) => !e.nationality);
      const need = new Map<string, number>();
      for (const r of f.setup) if (r.kind === "place" && r.strength !== undefined) need.set(`${r.type}:${r.strength}`, (need.get(`${r.type}:${r.strength}`) ?? 0) + r.count);
      for (const [k, n] of need) expect(n, `${owner} needs ${n} of ${k}`).toBeLessThanOrEqual(total(own).get(k) ?? 0);
      // Requirements that name only a type (German armor and infantry in Libya) are checked by type.
      for (const r of f.setup) {
        if (r.kind !== "place" || r.strength !== undefined) continue;
        const have = own.filter((e) => e.type === r.type).reduce((n, e) => n + e.count, 0);
        expect(r.count, `${owner} needs ${r.count} ${r.type}`).toBeLessThanOrEqual(have);
      }
    }
  });

  it("starts wars between real owners, each pair once, and names real Minor-Allies", () => {
    const known = new Set<string>([...owners, ...Object.keys(s.nations)]);
    const seen = new Set<string>();
    for (const [a, b] of s.warsAtStart) {
      expect(known.has(a) && known.has(b), `${a} vs ${b}`).toBe(true);
      expect(a).not.toBe(b);
      const k = [a, b].sort().join("|");
      expect(seen.has(k), `${k} listed twice`).toBe(false);
      seen.add(k);
    }
    for (const m of s.minorAllies) {
      expect(s.forces[m.owner], `${m.owner} has forces`).toBeDefined();
      expect(s.nations[m.of]).toBeDefined();
    }
  });

  it("has scenario rules that fall inside the scenario's dates", () => {
    const first = turnIndex(s.start), last = turnIndex(s.end);
    for (const r of s.rules) {
      if (r.kind === "no-brp-growth") expect(r.year).toBeGreaterThanOrEqual(s.start.year);
      else if ("turn" in r) {
        expect(turnIndex(r.turn)).toBeGreaterThanOrEqual(first);
        expect(turnIndex(r.turn)).toBeLessThanOrEqual(last);
      }
    }
  });

  it("starts a game that copies the pools, wars and Strategic Warfare without sharing them", () => {
    const g = newGame(s, 1);
    for (const o of owners) expect(g.pools[o]).toEqual({ forcePool: setupOf(s, o).forcePool, allowableBuilds: setupOf(s, o).allowableBuilds });
    expect(g.wars).toEqual(s.warsAtStart);
    expect(g.minorAllies).toEqual(s.minorAllies);
    // Every Major Power has a Strategic Warfare record, zero unless the page says otherwise.
    for (const p of Object.keys(s.nations) as (keyof Scenario["nations"])[]) {
      expect(g.strategicWarfare[p]).toEqual({ submarines: 0, asw: 0, sac: 0, ...s.startingStrategicWarfare[p] });
    }
    // Changing the game must leave the scenario alone.
    const o = owners[0]!;
    const wars = s.warsAtStart.length;
    const allies = s.minorAllies.length;
    const count = setupOf(s, o).forcePool[0]!.count;
    g.pools[o]!.forcePool[0]!.count = 0;
    g.wars.push(["italy", "britain"]);
    g.minorAllies.push({ owner: "poland", of: "germany", active: true });
    g.strategicWarfare.germany.submarines = 99;
    expect(setupOf(s, o).forcePool[0]!.count).toBe(count);
    expect(s.warsAtStart).toHaveLength(wars);
    expect(s.minorAllies).toHaveLength(allies);
    expect(s.startingStrategicWarfare.germany?.submarines ?? 0).not.toBe(99);
    // Dated builds are copied too.
    for (const owner of owners) {
      const dated = setupOf(s, owner).allowableBuilds.findIndex((e) => e.from);
      if (dated >= 0) {
        const copy = newGame(s, 1).pools[owner]!.allowableBuilds[dated]!;
        copy.from!.year = 3000;
        expect(setupOf(s, owner).allowableBuilds[dated]!.from!.year).toBeLessThan(3000);
      }
    }
  });

  it("survives a JSON round trip, scenario and state alike", () => {
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
    const g = newGame(s, 7);
    expect(JSON.parse(JSON.stringify(g))).toStrictEqual(g);
  });
});

describe("the zones the printed map does not show", () => {
  const unresolved = (s: Scenario) =>
    Object.entries(s.zones)
      .filter(([, z]) => z.hexes === null)
      .map(([id]) => id)
      .sort();

  // If this fails because a zone gained hexes, update docs/RULES.md "Open questions" in the same change.
  it("lists exactly what is still unknown, per scenario", () => {
    expect(unresolved(SCENARIO_1939)).toEqual(["poland-east-of-partition-line"]);
    expect(unresolved(SCENARIO_CAMPAIGN)).toEqual(["poland-east-of-partition-line"]);
    expect(unresolved(SCENARIO_1942)).toEqual(
      [
        "baltic-north-atlantic-ports", "eastern-europe", "european-turkey", "libya-east-of-start-line", "libya-west-of-start-line",
        "occupied-france", "ussr-east-of-start-line", "ussr-west-of-start-line", "vichy-france",
      ].sort(),
    );
    expect(unresolved(SCENARIO_1944)).toEqual(
      [
        "baltic-north-atlantic-ports", "eastern-europe", "european-turkey", "italy-north-of-start-line", "italy-south-of-start-line",
        "ussr-east-of-start-line", "ussr-west-of-start-line",
      ].sort(),
    );
  });

  it("reads the islands and mainland France off the map", () => {
    const z = SCENARIO_1944.zones;
    // Corsica, Sardinia and Rhodes are exactly the touching island hexes of their country on the map.
    expect(new Set(z.corsica!.hexes)).toEqual(landComponent("X20"));
    expect(new Set(z.sardinia!.hexes)).toEqual(landComponent("AA19"));
    expect(new Set(z.rhodes!.hexes)).toEqual(landComponent("FF30"));
    // Sicily touches the Italian mainland at the Strait of Messina, so it is checked by its cities.
    expect(MAP.hexes["DD21"]!.name).toBe("Messina");
    expect(MAP.hexes["EE21"]!.name).toBe("Syracuse");
    expect(MAP.hexes["AA19"]!.name).toBe("Cagliari");
    expect(MAP.hexes["X20"]!.name).toBe("Ajaccio");
    // Corsica and mainland France together are all of France.
    expect([...z["france-mainland"]!.hexes!, ...z.corsica!.hexes!].sort()).toEqual(landHexesOf("france").sort());
  });
});

describe("1939 scenario data (Ops 9.0, pp. 20-21)", () => {
  const s = SCENARIO_1939;

  it("covers the six Major Powers and Poland, deploying in the printed order", () => {
    expect(ownersOf(s).sort()).toEqual(["britain", "france", "germany", "italy", "poland", "usa", "ussr"]);
    expect(s.deploymentOrder).toEqual(["poland", "italy", "france", "britain", "ussr", "germany"]);
  });

  it("starts with Germany at war with Poland, France and Britain", () => {
    expect(s.warsAtStart).toEqual([["germany", "poland"], ["germany", "france"], ["germany", "britain"]]);
    expect(s.minorAllies).toEqual([]);
  });

  it("matches the printed force pools and builds, nation by nation", () => {
    const pb = (o: ForceOwner) => ({ pool: summary(setupOf(s, o).forcePool), builds: summary(setupOf(s, o).allowableBuilds) });
    expect(pb("poland")).toEqual({ pool: ["air:1x2", "infantry:1x7", "infantry:2x3"], builds: [] });
    expect(pb("germany")).toEqual({
      pool: ["air:5x4", "armor:4x4", "fleet:9x2", "infantry:3x8"],
      builds: ["air:5x2", "airborne:3x1", "armor:4x8", "fleet:9x2", "infantry:3x20", "replacement:1x8"],
    });
    expect(pb("usa")).toEqual({ pool: ["air:5x2", "armor:5x1", "fleet:9x4", "infantry:3x10"], builds: [] });
    // Spot totals read straight off the page: Britain's pool is 3+3+1+1+6+2+4 counters,
    // the USSR's is 12+5+3+3+2, Italy's 2+6+1+4+2, France's 12+1+3+2+2.
    const n = (o: ForceOwner) => setupOf(s, o).forcePool.reduce((sum, e) => sum + e.count, 0);
    expect([n("britain"), n("ussr"), n("italy"), n("france")]).toEqual([20, 25, 15, 20]);
  });

  it("gives Poland the same forces as the Minor Country Forces chart (a separate page of the manual)", () => {
    const chart = MINOR_COUNTRY_FORCES.poland;
    const pool = total(setupOf(s, "poland").forcePool);
    expect(pool.get("infantry:1")).toBe(chart.inf1_3);
    expect(pool.get("infantry:2")).toBe(chart.inf2_3);
    expect(pool.get("air:1")).toBe(chart.air1_4);
  });

  it("names the territories the page names, including islands that are part of a country on the map", () => {
    const ctrl = (o: ForceOwner) => setupOf(s, o).controlledAtStart;
    expect(ctrl("italy")).toEqual(["italy", "albania", "libya"]);
    expect(ctrl("britain")).toEqual(["britain", "egypt", "iraq", "palestine", "transjordan"]);
    expect(ctrl("france")).toEqual(["france", "algeria", "morocco", "tunisia", "lebanon-syria"]);
    const countryOf = (name: string) => hexes.find((h) => h.name === name)?.country;
    // Malta, Gibraltar and Cyprus (Famagusta) are British; Corsica (Ajaccio) French; Sardinia, Sicily, Rhodes Italian.
    expect(["Malta", "Gibraltar", "Famagusta"].map(countryOf)).toEqual(["britain", "britain", "britain"]);
    expect(countryOf("Ajaccio")).toBe("france");
    expect(["Cagliari", "Messina"].map(countryOf)).toEqual(["italy", "italy"]);
    expect(MAP.hexes["GG19"]?.name).toBe("Malta");
  });

  it("puts the Soviet setup units on the cities the page names", () => {
    const hexOfCity = (name: string) => hexes.find((h) => h.name === name)?.id;
    const placed = setupOf(s, "ussr").setup.flatMap((r) => (r.kind === "place" && "hex" in r.in[0]! ? [[r.type, r.strength, r.in[0].hex] as const] : []));
    expect(placed).toEqual([
      ["infantry", 2, hexOfCity("Leningrad")],
      ["armor", 3, hexOfCity("Moscow")],
      ["infantry", 1, hexOfCity("Odessa")],
      ["infantry", 1, hexOfCity("Kharkov")],
      ["infantry", 1, hexOfCity("Grozny")],
    ]);
    expect(hexOfCity("Gibraltar")).toBe("AA7");
  });

  it("keeps Germany's 20 Eastern Front factors within what Germany can field", () => {
    const g = setupOf(s, "germany");
    const factors = g.forcePool.filter((e) => e.type === "infantry" || e.type === "armor" || e.type === "air").reduce((n, e) => n + e.strength * e.count, 0);
    expect(g.setup.find((r) => r.kind === "min-factors")).toMatchObject({ front: "eastern", min: 20 });
    expect(factors).toBeGreaterThan(20);
  });

  it("carries the USA's automatic Spring '42 declaration, and ends in Summer '42", () => {
    expect(s.rules).toContainEqual({
      kind: "automatic-declaration", by: "usa", on: "germany", turn: { year: 1942, season: "spring" }, side: "allies", brpCost: 35,
    });
    expect(s.end).toEqual({ year: 1942, season: "summer" });
    expect(s.startingYss).toBe("none");
  });
});

describe("1942 scenario data (Ops 9.0, pp. 22-24)", () => {
  const s = SCENARIO_1942;

  it("deploys in the printed order and starts with the Allies at war with Germany and Italy", () => {
    expect(s.deploymentOrder).toEqual(["usa", "britain", "free-france", "ussr", "italy", "germany", "finland", "rumania", "bulgaria", "hungary", "vichy-france"]);
    for (const a of ["usa", "britain", "ussr"] as const) {
      for (const b of ["germany", "italy", "finland", "rumania", "hungary", "bulgaria"] as const) {
        expect(s.warsAtStart.some(([x, y]) => x === a && y === b), `${a} vs ${b}`).toBe(true);
      }
    }
    expect(s.warsAtStart).toHaveLength(18);
    expect(s.minorAllies.filter((m) => m.active).map((m) => m.owner)).toEqual(["finland", "rumania", "hungary", "bulgaria"]);
    expect(s.minorAllies.find((m) => m.owner === "vichy-france")).toEqual({ owner: "vichy-france", of: "germany", active: false });
  });

  it("matches the printed BRPs, growth rates and statuses", () => {
    const n = s.nations;
    expect([n.usa, n.britain, n.ussr, n.italy, n.germany].map((x) => [x.status, x.brpBase, x.brpTotal, x.growthRate])).toEqual([
      ["allied", 270, 270, 60],
      ["allied", 160, 160, 40],
      ["allied", 110, 110, 30],
      ["axis", 90, 90, 20],
      ["axis", 245, 290, 50],
    ]);
    expect(n.france.status).toBe("vichy");
    // Germany's 290 = 245 base + 45 for the four Minor-Allies.
    expect(n.germany.brpTotal - n.germany.brpBase).toBe(45);
  });

  it("matches the printed force pools and builds, nation by nation", () => {
    const pb = (o: ForceOwner) => ({ pool: summary(setupOf(s, o).forcePool), builds: summary(setupOf(s, o).allowableBuilds) });
    expect(pb("usa")).toEqual({
      pool: ["air:5x2", "armor:5x1", "fleet:9x4", "infantry:3x10"],
      builds: ["air:5x3", "airborne:3x1", "armor:5x4", "fleet:9x3", "infantry:3x5", "replacement:1x7"],
    });
    expect(pb("britain")).toEqual({
      pool: ["air:5x2", "armor:4x3", "fleet:9x9", "infantry:1x3", "infantry:3x6"],
      builds: ["air:5x2", "airborne:3x1", "armor:4x1", "fleet:9x1", "infantry:3x1", "replacement:1x6"],
    });
    expect(pb("ussr")).toEqual({
      pool: ["air:5x2", "airborne:2x2", "armor:3x6", "fleet:9x3", "infantry:1x15", "infantry:2x7"],
      builds: ["air:5x1", "armor:4x4", "infantry:2x3", "infantry:3x20"],
    });
    expect(pb("italy")).toEqual({
      pool: ["air:5x2", "airborne:2x1", "armor:2x2", "fleet:9x6", "infantry:1x6", "infantry:2x4", "infantry:3x2"],
      builds: ["replacement:1x6"],
    });
    expect(pb("germany")).toEqual({
      pool: ["air:5x4", "armor:4x8", "fleet:9x3", "infantry:3x28"],
      builds: ["air:5x2", "airborne:3x1", "armor:4x4", "armor:5x2", "replacement:1x8"],
    });
    expect(pb("vichy-france")).toEqual({ pool: ["fleet:9x1", "infantry:2x6"], builds: [] });
    expect(pb("free-france")).toEqual({ pool: ["infantry:2x2"], builds: [] });
  });

  it("dates the builds the page stars", () => {
    const dated = (o: ForceOwner) => setupOf(s, o).allowableBuilds.filter((e) => e.from).map((e) => [key(e), e.from]);
    expect(dated("britain")).toEqual([["airborne:3", { year: 1942, season: "summer" }]]);
    expect(dated("germany")).toEqual([["armor:5", { year: 1943 }]]);
  });

  it("gives the Axis Minor-Allies the pools of the Minor Country Forces chart", () => {
    for (const m of ["finland", "rumania", "hungary", "bulgaria"] as const) {
      const pool = total(setupOf(s, m).forcePool);
      const chart = MINOR_COUNTRY_FORCES[m];
      expect([pool.get("infantry:1") ?? 0, pool.get("infantry:2") ?? 0, pool.get("air:1") ?? 0], m).toEqual([chart.inf1_3, chart.inf2_3, chart.air1_4]);
    }
  });

  it("agrees with the Campaign page, which prints the same counters with later build dates (cross-check between pages)", () => {
    // Pool plus builds is the same in 1942 as in the Campaign, dated builds included, for Italy and the USSR.
    for (const o of ["italy", "ussr"] as const) {
      expect([...countFor(s, o)].sort(), o).toEqual([...countFor(SCENARIO_CAMPAIGN, o)].sort());
    }
    // The USA's counters and the starred builds appear on both pages.
    expect(setupOf(s, "usa").allowableBuilds).toEqual(setupOf(SCENARIO_CAMPAIGN, "usa").allowableBuilds);
    expect(setupOf(s, "usa").forcePool).toEqual(setupOf(SCENARIO_CAMPAIGN, "usa").forcePool);
    expect(setupOf(s, "germany").allowableBuilds.filter((e) => e.from)).toEqual(
      setupOf(SCENARIO_CAMPAIGN, "germany").allowableBuilds.filter((e) => e.from && e.from.year === 1943),
    );
    expect(setupOf(s, "britain").allowableBuilds.filter((e) => e.from)).toEqual(
      setupOf(SCENARIO_CAMPAIGN, "britain").allowableBuilds.filter((e) => e.type === "airborne"),
    );
  });

  it("starts the Strategic Warfare the page gives Germany, and runs only SW construction", () => {
    expect(s.startingYss).toBe("sw-construction-only");
    expect(newGame(s, 1).strategicWarfare.germany).toEqual({ submarines: 6, asw: 0, sac: 0 });
    expect(newGame(s, 1).strategicWarfare.britain).toEqual({ submarines: 0, asw: 0, sac: 0 });
  });

  it("puts the Soviet minimum next to Leningrad and Moscow", () => {
    expect(setupOf(s, "ussr").setup).toEqual([{ kind: "min-ground-factors-near", hexes: ["D44", "H47"], min: 6 }]);
    expect(MAP.hexes["D44"]!.name).toBe("Leningrad");
    expect(MAP.hexes["H47"]!.name).toBe("Moscow");
  });

  it("gives the Finns the hexes Ref 17.3 names, in 1942 only", () => {
    expect(setupOf(s, "finland").mayAlsoSetUpIn).toEqual([{ areas: [{ hex: "A47" }, { hex: "B46" }], axisControlled: true }]);
    expect(setupOf(SCENARIO_1944, "finland").mayAlsoSetUpIn).toEqual([]);
  });
});

describe("1944 scenario data (Ops 9.0, pp. 24-26)", () => {
  const s = SCENARIO_1944;

  it("has the Allies move first and Italy and France out of the game", () => {
    expect(s.firstSide).toBe("allies");
    expect(s.nations.italy.status).toBe("out");
    expect(s.nations.france.status).toBe("out");
    expect(s.forces.italy).toBeUndefined();
    expect(s.forces["vichy-france"]).toBeUndefined();
    expect(s.deploymentOrder).toEqual(["usa", "britain", "free-france", "ussr", "germany", "finland", "rumania", "bulgaria", "hungary"]);
    expect(s.warsAtStart).toHaveLength(15);
    expect(s.rules).toContainEqual({ kind: "no-war-on-neutrals" });
  });

  it("matches the printed BRPs and growth rates", () => {
    const n = s.nations;
    expect([n.usa, n.britain, n.ussr, n.germany].map((x) => [x.brpBase, x.brpTotal, x.growthRate])).toEqual([
      [400, 400, 60],
      [220, 220, 40],
      [130, 130, 30],
      [325, 370, 50],
    ]);
  });

  it("matches the printed force pools and builds, nation by nation", () => {
    const pb = (o: ForceOwner) => ({ pool: summary(setupOf(s, o).forcePool), builds: summary(setupOf(s, o).allowableBuilds) });
    expect(pb("usa")).toEqual({
      pool: ["air:5x5", "airborne:3x1", "armor:5x4", "fleet:9x7", "infantry:3x10"],
      builds: ["armor:5x1", "infantry:3x5", "replacement:1x7"],
    });
    expect(pb("britain")).toEqual({
      pool: ["air:5x4", "airborne:3x1", "armor:4x4", "fleet:9x10", "infantry:1x3", "infantry:3x7", "replacement:1x6"],
      builds: [],
    });
    expect(pb("ussr")).toEqual({
      pool: ["air:5x3", "airborne:2x2", "armor:3x6", "armor:4x4", "fleet:9x2", "infantry:1x6", "infantry:2x10", "infantry:3x20"],
      builds: [],
    });
    expect(pb("germany")).toEqual({
      pool: ["air:5x6", "airborne:3x1", "armor:4x6", "armor:5x2", "fleet:6x1", "fleet:9x2", "infantry:3x31"],
      builds: ["armor:4x5", "infantry:1x6", "replacement:1x8"],
    });
    expect(pb("free-france")).toEqual({ pool: ["infantry:2x2"], builds: [] });
  });

  it("marks the Italian fleet in the German pool", () => {
    expect(setupOf(s, "germany").forcePool.filter((e) => e.nationality)).toEqual([{ type: "fleet", strength: 6, count: 1, nationality: "italy" }]);
  });

  it("starts the Strategic Warfare the page gives the USA and Britain", () => {
    const g = newGame(s, 1);
    expect(g.strategicWarfare.usa).toEqual({ submarines: 0, asw: 2, sac: 3 });
    expect(g.strategicWarfare.britain).toEqual({ submarines: 0, asw: 2, sac: 2 });
    expect(g.strategicWarfare.germany).toEqual({ submarines: 0, asw: 0, sac: 0 });
  });

  it("gives the Axis Minor-Allies the same pools as in 1942", () => {
    for (const m of ["finland", "rumania", "hungary", "bulgaria"] as const) {
      expect(setupOf(s, m).forcePool).toEqual(setupOf(SCENARIO_1942, m).forcePool);
    }
  });

  it("splits France and Italy between Germany and Britain", () => {
    expect(setupOf(s, "germany").controlledZones).toEqual(["france-mainland", "rhodes", "italy-north-of-start-line", "ussr-west-of-start-line"]);
    expect(setupOf(s, "britain").controlledZones).toEqual(["corsica", "sardinia", "sicily", "italy-south-of-start-line"]);
  });
});

describe("Campaign scenario data (Ops 9.0, pp. 26-27)", () => {
  const s = SCENARIO_CAMPAIGN;

  it("starts exactly as the 1939 scenario does", () => {
    expect(s.start).toEqual(SCENARIO_1939.start);
    expect(s.nations).toEqual(SCENARIO_1939.nations);
    expect(s.warsAtStart).toEqual(SCENARIO_1939.warsAtStart);
    expect(s.deploymentOrder).toEqual(SCENARIO_1939.deploymentOrder);
    for (const o of ownersOf(SCENARIO_1939)) {
      expect(setupOf(s, o).forcePool, o).toEqual(setupOf(SCENARIO_1939, o).forcePool);
      expect(setupOf(s, o).setup, o).toEqual(setupOf(SCENARIO_1939, o).setup);
      // The Campaign only adds builds: the 1939 builds are a prefix of its list (the USA's are printed only on this page).
      if (o !== "usa") {
        const b = setupOf(SCENARIO_1939, o).allowableBuilds;
        expect(setupOf(s, o).allowableBuilds.slice(0, b.length), o).toEqual(b);
      }
    }
  });

  it("runs to Summer '45 and drops the 1939 page's Summer '42 Seaborne Invasion ban", () => {
    expect(s.end).toEqual({ year: 1945, season: "summer" });
    expect(s.rules.some((r) => r.kind === "no-seaborne-invasion")).toBe(false);
    expect(s.rules).toContainEqual({
      kind: "automatic-declaration", by: "usa", on: "germany", turn: { year: 1942, season: "spring" }, side: "allies", brpCost: 35,
    });
  });

  it("dates the starred builds the page prints", () => {
    const dated = (o: ForceOwner) =>
      setupOf(s, o).allowableBuilds.filter((e) => e.from).map((e) => `${key(e)}x${e.count}@${e.from!.year}${e.from!.season ? "-" + e.from!.season : ""}`);
    expect(dated("italy")).toEqual(["airborne:2x1@1942", "fleet:9x1@1942"]);
    expect(dated("britain")).toEqual(["infantry:3x1@1942-summer", "airborne:3x1@1942-summer", "armor:4x1@1942-summer", "fleet:9x1@1942-summer"]);
    expect(dated("ussr")).toEqual(["infantry:3x15@1942", "airborne:2x2@1942", "armor:4x4@1942"]);
    expect(dated("germany")).toEqual(["armor:5x2@1943", "infantry:3x3@1944", "infantry:1x6@1944", "armor:4x1@1944"]);
    expect(dated("usa")).toEqual([]);
  });

  it("gives the USA the builds the Campaign page prints", () => {
    expect(summary(setupOf(s, "usa").allowableBuilds)).toEqual(["air:5x3", "airborne:3x1", "armor:5x4", "fleet:9x3", "infantry:3x5", "replacement:1x7"]);
  });

  it("leaves the 1939 scenario untouched when a Campaign game changes its counters", () => {
    const g = newGame(s, 1);
    const builds = g.pools.germany!.allowableBuilds;
    builds[builds.length - 1]!.count = 99;
    expect(setupOf(s, "germany").allowableBuilds.at(-1)!.count).toBe(1);
    expect(setupOf(SCENARIO_1939, "germany").allowableBuilds).toHaveLength(6);
  });
});
