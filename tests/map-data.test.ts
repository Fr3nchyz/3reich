import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { hex, neighbors, hexId, hexsideId } from "../src/engine/hex";
import { validateMap } from "../src/engine/map";

const hexes = Object.values(MAP.hexes);
const byName = new Map(hexes.filter((h) => h.name).map((h) => [h.name!, h]));
const side = (id: string) => MAP.hexsides[id];

describe("map data (src/data/map.json)", () => {
  it("passes validateMap", () => {
    expect(validateMap(MAP)).toEqual([]);
  });

  it("is one connected map of the expected size", () => {
    expect(hexes.length).toBeGreaterThan(1700);
    const seen = new Set<string>(["K21"]);
    const queue = ["K21"];
    while (queue.length) {
      for (const n of neighbors(hex(queue.pop()!))) {
        const id = n.r >= 0 && n.r < 40 && n.q >= 0 ? hexId(n) : "";
        if (MAP.hexes[id] && !seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
      }
    }
    expect(seen.size).toBe(hexes.length);
  });

  it("places the Ref 4.1 example cities", () => {
    const examples = { Lisbon: "V8", Marrakech: "EE2", Dublin: "H22", Rome: "Y22", Berlin: "L31", Helsinki: "D41", Moscow: "H47", Perma: "D61" };
    for (const [name, id] of Object.entries(examples)) expect(byName.get(name)?.id, name).toBe(id);
  });

  it("places Plymouth and Brindisi where Ref 4.7 says, as ports", () => {
    expect(MAP.hexes.K21).toMatchObject({ name: "Plymouth", features: expect.arrayContaining(["port"]) });
    expect(MAP.hexes.AA25).toMatchObject({ name: "Brindisi", features: expect.arrayContaining(["port"]) });
  });

  it("has exactly the 42 Objectives of Ref 2.1, on the right Fronts", () => {
    const fronts = {
      western: "Antwerp Berlin Birmingham Bonn Breslau Budapest Essen Leipzig London Lyons Manchester Marseilles Oslo Paris",
      eastern: "Astrakhan Dnepropetrovsk Grozny Kharkov Krakow Leningrad Lvov Maikop Moscow Riga Smolensk Stalingrad Stockholm Warsaw",
      mediterranean: "Alexandria Athens Belgrade Genoa Gibraltar Istanbul Madrid Malta Milan Mosul Ploesti Rome Suez Tripoli",
    };
    const objectives = hexes.filter((h) => h.features.includes("objective"));
    expect(objectives).toHaveLength(42);
    for (const [front, names] of Object.entries(fronts)) {
      for (const name of names.split(" ")) {
        const h = byName.get(name);
        expect(h?.features, name).toContain("objective");
        expect(h?.front, name).toBe(front);
      }
    }
  });

  it("has Athens and Stockholm as the only capital-ports (Ref 4.7)", () => {
    const cp = hexes.filter((h) => h.features.includes("capital-port")).map((h) => h.name).sort();
    expect(cp).toEqual(["Athens", "Stockholm"]);
  });

  it("marks the Qattara hexsides as impassable (Ref 4.51)", () => {
    for (const id of ["NN25-NN26", "NN26-NN27", "MM26-NN26", "MM27-NN26"]) {
      expect(side(id), id).toMatchObject({ qattara: true, land: false });
    }
    expect(MAP.hexes.NN26?.land).toBe("qattara-depression");
  });

  it("has the eight crossing arrows of Ref 4.6", () => {
    const arrows = Object.values(MAP.hexsides).filter((s) => s.crossingArrow).map((s) => s.id).sort();
    expect(arrows).toEqual(["AA31-BB31", "B29-C28", "DD21-DD22", "F33-G32", "I30-I31", "I31-I32", "U40-U41", "Z33-Z34"]);
    // Each joins two land hexes across water.
    for (const id of arrows) {
      const [a, b] = id.split("-").map((h) => MAP.hexes[h]);
      expect(a?.land && b?.land, id).toBeTruthy();
    }
  });

  it("marks the Suez Canal hexsides (Ref 4.3)", () => {
    for (const id of ["LL30-LL31", "LL31-MM30", "MM30-MM31"]) expect(side(id)?.suezCanal, id).toBe(true);
  });

  it("marks the fortresses of Ref 4.8", () => {
    const kind = (name: string) => byName.get(name)?.fortress;
    expect([kind("Gibraltar"), kind("Malta")]).toEqual(["permanent", "permanent"]);
    expect([kind("Metz"), kind("Strasbourg"), MAP.hexes.P25?.fortress]).toEqual(["maginot", "maginot", "maginot"]);
    expect(["Stuttgart", "Frankfurt", "Bonn", "Essen"].map(kind)).toEqual(["west-wall", "west-wall", "west-wall", "west-wall"]);
    expect(kind("Sevastopol")).toBe("sevastopol");
  });

  it("leaves Switzerland unplayable (Ref 4.2)", () => {
    expect(MAP.hexes.S23).toBeUndefined();
  });

  it("puts East Prussia and Bessarabia on the Eastern Front (Ref 4.4)", () => {
    expect(byName.get("Konigsberg")).toMatchObject({ country: "germany", front: "eastern" });
    expect(byName.get("Kishinev")).toMatchObject({ country: "rumania", front: "eastern" });
    expect(byName.get("Berlin")?.front).toBe("western");
    expect(byName.get("Bucharest")?.front).toBe("mediterranean");
  });

  it("separates countries with national boundaries", () => {
    // Belgium-Germany along the Rhine; Germany-Poland, also a front line.
    expect(side(hexsideId(hex("M26"), hex("M27")))).toMatchObject({ river: true, nationalBoundary: true });
    expect(side("N33-O32")).toMatchObject({ nationalBoundary: true, frontBoundary: true });
    expect(side("M25-M26")?.nationalBoundary).toBeUndefined();
  });

  it("marks the green-dot US Box entry hexes along the west edge (Ref 4.3)", () => {
    const entries = hexes.filter((h) => h.usBoxEntry);
    expect(entries.length).toBe(28);
    for (const h of entries) expect(h.land, h.id).toBeNull();
  });
});
