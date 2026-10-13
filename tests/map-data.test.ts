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

  // Facts checked against the original game's own map data (BINMAP.BIN) and the scan; see
  // docs/MAP_COMPARISON.md. The game files are not read here.
  describe("agrees with the original game's map data", () => {
    it("treats coastal slivers as land, with the game's country", () => {
      const slivers = {
        B33: "norway", G31: "denmark", G38: "baltic-states", H23: "britain", H37: "baltic-states", I22: "britain",
        I34: "sweden", T40: "ussr", U49: "ussr", W52: "ussr", Z48: "ussr", BB25: "italy", BB48: "persia",
        DD29: "greece", EE27: "greece", FF32: "turkey", LL20: "libya",
        // Slivers the 4% land threshold already kept as land; the game agrees.
        S42: "ussr", V39: "ussr", H26: "britain", J29: "germany", EE19: "italy", KK25: "libya", CC28: "greece", DD19: "italy", K25: "britain",
      };
      for (const [id, country] of Object.entries(slivers)) expect(MAP.hexes[id], id).toMatchObject({ sea: true, country });
      for (const id of Object.keys(slivers)) expect(MAP.hexes[id]?.land, id).not.toBeNull();
    });

    it("joins all of Sicily by land, and Sicily to the mainland only by the Messina arrow", () => {
      for (const id of ["DD19-DD20", "DD20-DD21", "DD19-EE19", "DD20-EE19", "DD20-EE20", "EE19-EE20", "DD21-EE20", "DD21-EE21", "EE20-EE21"]) {
        expect(side(id)?.land, id).toBe(true);
      }
      expect(side("DD21-DD22")).toMatchObject({ land: false, crossingArrow: true });
    });

    it("gives D43 to Finland and the Aegean island CC30 (Lesbos) to Greece", () => {
      expect(MAP.hexes.D43?.country).toBe("finland");
      expect(MAP.hexes.CC30?.country).toBe("greece");
      expect(side("BB31-CC30")?.land).toBe(false);
    });

    it("blocks ground movement across hexsides covered by a lake, estuary or gulf (Ref 4.3)", () => {
      for (const id of ["C42-C43", "E35-F35", "G42-H41", "J30-K29", "K26-L25", "M23-N22", "R17-R18", "JJ34-JJ35", "LL33-LL34", "NN32-NN33"]) {
        expect(side(id), id).toMatchObject({ land: false });
        expect(side(id)?.river, id).toBeUndefined();
      }
    });

    it("does not call inland river hexes coastal", () => {
      for (const id of ["M35", "N26", "O22", "O26", "U28", "W32", "W34"]) expect(MAP.hexes[id], id).toMatchObject({ sea: false });
    });

    it("places the cities as the game does", () => {
      expect(byName.get("Oslo")?.features).toEqual(["capital", "objective"]);
      expect(byName.get("Tangiers")?.id).toBe("BB6");
      expect(byName.get("Buerat")?.id).toBe("KK18");
      expect(byName.get("Izmit")).toMatchObject({ id: "AA33", features: ["port"] });
      expect(byName.get("Kars")).toMatchObject({ id: "Z43", features: ["city"] });
      expect(byName.get("Rostov")?.features).toEqual(["city"]);
      expect(byName.get("Bilbao")?.features).toEqual(["city"]);
    });
  });

  it("marks the green-dot US Box entry hexes along the west edge (Ref 4.3)", () => {
    const entries = hexes.filter((h) => h.usBoxEntry);
    expect(entries.length).toBe(28);
    for (const h of entries) expect(h.land, h.id).toBeNull();
  });
});
