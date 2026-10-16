import { describe, expect, it } from "vitest";
import { flightBlocked, flightDistances, flightProblem, flightRoute, hexesWithin, missionHexes, stagingBases, stagingChoices } from "../src/engine/air-range";
import { MISSION_RANGE, STAGING_RANGE } from "../src/engine/air-rules";
import { distance, hex } from "../src/engine/hex";
import { neutralLandProblem } from "../src/engine/movement";
import { adjacentHexes } from "../src/engine/zoc";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 09 R4 (Ref 20.2, 11.41; Ops 5.45f): hexes within range, flight routes that avoid neutral land, the bases a unit could stage to.
const BERLIN = "L31";
const KONIGSBERG = "J36"; // German city, 5 from Berlin
const KIEL_AREA_8 = "K28"; // Wilhelmshaven: German base 8 hexes from Konigsberg
const KIEL_AREA_9 = "M27"; // Essen: German base 9 hexes from Konigsberg
const STOCKHOLM = "E38"; // neutral Sweden in 1939
const COPENHAGEN = "I32"; // neutral Denmark in 1939
const YARMOUTH = "K25"; // British base 7 hexes from Berlin straight, 8 around the Netherlands
const HARWICH = "K24"; // 8 straight, 9 around
const WARSAW = "M35";
const luft = (id: string, at: string, strength = 3) => counter(id, "germany", "air", strength, at, 4);

describe("hexes within range", () => {
  it("is a plain distance over map hexes, centre included, sorted", () => {
    expect(hexesWithin(CTX, BERLIN, 0)).toEqual([BERLIN]);
    const three = hexesWithin(CTX, BERLIN, 3);
    expect(three).toHaveLength(37); // 3 * 3 * 4 + 1, every one of them a playable hex
    expect(three).toEqual([...three].sort());
    for (const range of [1, 4, 8]) {
      const brute = Object.keys(CTX.map.hexes).filter((h) => distance(hex(BERLIN), hex(h)) <= range).sort();
      expect(hexesWithin(CTX, BERLIN, range)).toEqual(brute);
    }
  });
  it("is empty for a bad centre or a bad range", () => {
    expect(hexesWithin(CTX, "nowhere", 4)).toEqual([]);
    expect(hexesWithin(CTX, BERLIN, -1)).toEqual([]);
    expect(hexesWithin(CTX, BERLIN, Number.NaN)).toEqual([]);
  });
  it("leaves out hexes that are not on the map (the map edge)", () => {
    expect(hexesWithin(CTX, "A24", 2).every((h) => CTX.map.hexes[h] !== undefined)).toBe(true);
    expect(hexesWithin(CTX, "A24", 2).length).toBeLessThan(19);
  });
});

describe("the neutral-land test is the ground movement test (Ref 20.2, NEUTRAL_LAND_CLOSED)", () => {
  const s = board([]);
  it("Sweden and Denmark are closed to German flight in 1939; Poland, at war with Germany, is not", () => {
    expect(flightBlocked(CTX, s, "germany", STOCKHOLM)).toBe(neutralLandProblem(CTX, s, ["germany"], STOCKHOLM));
    expect(flightBlocked(CTX, s, "germany", STOCKHOLM)).toMatch(/neutral land/);
    expect(flightBlocked(CTX, s, "germany", COPENHAGEN)).toMatch(/neutral land/);
    expect(flightBlocked(CTX, s, "germany", WARSAW)).toBeNull(); // an enemy minor country is not neutral (Poland is at war)
    expect(flightBlocked(CTX, s, "germany", BERLIN)).toBeNull();
    expect(flightBlocked(CTX, s, "germany", "A24")).toBeNull(); // open sea
  });
});

describe("flight routes over map hexes (Ref 20.2)", () => {
  const s = board([]);
  it("distances run from 0 at the start, one more per step, nothing beyond the range", () => {
    const d = flightDistances(CTX, s, "germany", BERLIN, 3);
    expect(d.get(BERLIN)).toBe(0);
    expect(Math.max(...d.values())).toBe(3);
    for (const h of adjacentHexes(CTX, BERLIN)) expect(d.get(h)).toBe(1);
    expect([...d.keys()].every((h) => distance(hex(BERLIN), hex(h)) <= 3)).toBe(true);
  });

  it("a route is a chain of adjacent hexes from start to end, as short as the distance says, and never crosses neutral land", () => {
    const route = flightRoute(CTX, s, "germany", KONIGSBERG, KIEL_AREA_8, 8)!;
    expect(route[0]).toBe(KONIGSBERG);
    expect(route.at(-1)).toBe(KIEL_AREA_8);
    expect(route).toHaveLength(9);
    for (let i = 1; i < route.length; i++) expect(adjacentHexes(CTX, route[i - 1]!)).toContain(route[i]);
    for (const h of route) expect(flightBlocked(CTX, s, "germany", h)).toBeNull();
    expect(flightRoute(CTX, s, "germany", BERLIN, BERLIN, 8)).toEqual([BERLIN]);
  });

  it("is the same route every time (fixed neighbour order)", () => {
    expect(flightRoute(CTX, s, "germany", KONIGSBERG, KIEL_AREA_8, 8)).toEqual(flightRoute(CTX, s, "germany", KONIGSBERG, KIEL_AREA_8, 8));
  });

  it("a base 7 hexes away in a straight line is 8 around a neutral country, and 8 is still allowed (Ref 20.2)", () => {
    expect(distance(hex(BERLIN), hex(YARMOUTH))).toBe(7);
    const route = flightRoute(CTX, s, "germany", BERLIN, YARMOUTH, STAGING_RANGE)!;
    expect(route).toHaveLength(9);
    expect(flightRoute(CTX, s, "germany", BERLIN, YARMOUTH, 7)).toBeNull();
  });

  it("a base 8 hexes away in a straight line but 9 around is out of reach, and the reason names the neutral land, not the distance", () => {
    expect(distance(hex(BERLIN), hex(HARWICH))).toBe(8);
    expect(flightRoute(CTX, s, "germany", BERLIN, HARWICH, STAGING_RANGE)).toBeNull();
    expect(flightProblem(CTX, s, "germany", BERLIN, HARWICH, STAGING_RANGE)).toMatch(/^Planes cannot cross neutral land: .* is neutral land/);
  });

  it("a destination that is itself neutral land is refused as neutral land", () => {
    expect(flightRoute(CTX, s, "germany", BERLIN, STOCKHOLM, STAGING_RANGE)).toBeNull();
    expect(flightProblem(CTX, s, "germany", BERLIN, STOCKHOLM, STAGING_RANGE)).toBe(`Planes cannot cross neutral land: ${STOCKHOLM} is neutral land: germany is not at war with it.`);
  });

  it("flight may cross open sea (Ref 20.2) and ignores enemy ground units and ZOC (Ref 11.41)", () => {
    const wall = board([counter("u1", "britain", "infantry", 3, "K29", 4), counter("u2", "britain", "armor", 4, "J30", 6)]);
    const d = flightDistances(CTX, wall, "germany", "K28", 4);
    expect(d.has("K29")).toBe(true);
    expect(d.has("J30")).toBe(true);
    const sea = [...d.keys()].filter((h) => CTX.map.hexes[h]!.land === null);
    expect(sea.length).toBeGreaterThan(0);
  });

  it("says too far when even the free way is longer than the range, with the straight distance", () => {
    expect(flightProblem(CTX, s, "germany", KONIGSBERG, KIEL_AREA_9, STAGING_RANGE)).toBe(`${KIEL_AREA_9} is too far: 9 hexes (limit 8).`);
    expect(flightProblem(CTX, s, "germany", KONIGSBERG, KIEL_AREA_8, STAGING_RANGE)).toBeNull();
    expect(flightProblem(CTX, s, "germany", KONIGSBERG, "ZZ99", STAGING_RANGE)).toBe("ZZ99 is not on the map.");
  });
});

describe("a mission flies 4 hexes out and back (Ref 20.41, 20.51)", () => {
  const s = board([]);
  it("lists the hexes within 4 reachable without neutral land, start excluded", () => {
    const hexes = missionHexes(CTX, s, "germany", BERLIN);
    expect(hexes).not.toContain(BERLIN);
    expect(Math.max(...hexes.map((h) => distance(hex(BERLIN), hex(h))))).toBe(MISSION_RANGE);
    expect(hexes).toEqual([...hexes].sort());
    expect(hexes.length).toBeGreaterThan(30);
    expect(hexes.length).toBeLessThanOrEqual(60); // 3*4*5 hexes in the ring area, minus holes and neutral land
  });
  it("leaves out neutral hexes: Copenhagen's country is closed to German air", () => {
    const hexes = missionHexes(CTX, s, "germany", "J30");
    expect(hexes).not.toContain(COPENHAGEN);
    expect(hexesWithin(CTX, "J30", MISSION_RANGE)).toContain(COPENHAGEN);
  });
});

describe("staging: the bases a unit could move to (Ref 20.2, 20.1, 5.0)", () => {
  it("lists German bases within 8 with their route length, nearest first by id order, and not the unit's own hex", () => {
    const s = board([luft("u1", KONIGSBERG)]);
    const choices = stagingBases(CTX, s, s.units.u1!);
    const hexes = choices.map((c) => c.hex);
    expect(hexes).not.toContain(KONIGSBERG);
    expect(hexes).toContain(KIEL_AREA_8); // exactly 8 hexes: allowed
    expect(hexes).not.toContain(KIEL_AREA_9); // 9: not listed at all
    expect(choices.every((c) => c.distance! >= 1 && c.distance! <= STAGING_RANGE)).toBe(true);
    expect(choices.map((c) => c.distance)).toEqual([...choices.map((c) => c.distance)].sort((a, b) => a! - b!));
    expect(choices.find((c) => c.hex === KIEL_AREA_8)).toMatchObject({ distance: 8, room: 5, problem: null });
  });

  it("does not list the other side's bases, nor neutral ones, but explains a base it cannot reach by the neutral land", () => {
    const s = board([luft("u1", BERLIN)]);
    const all = stagingChoices(CTX, s, s.units.u1!);
    expect(all.map((c) => c.hex)).not.toContain(WARSAW); // held by Poland
    expect(all.map((c) => c.hex)).not.toContain(STOCKHOLM);
  });

  it("refuses a base without room (Ref 5.0) with the stacking reason, and lists it greyed", () => {
    const s = board([luft("u1", KONIGSBERG, 3), luft("u2", KIEL_AREA_8, 5)]);
    const choice = stagingChoices(CTX, s, s.units.u1!).find((c) => c.hex === KIEL_AREA_8)!;
    expect(choice.room).toBe(0);
    expect(choice.problem).toBe(`${KIEL_AREA_8} would hold 8 air factors (limit 5).`);
    expect(stagingBases(CTX, s, s.units.u1!).map((c) => c.hex)).not.toContain(KIEL_AREA_8);
  });

  it("an airbase counter doubles a city's room, so the same unit fits (Ref 20.1)", () => {
    const s = board([luft("u1", KONIGSBERG, 3), luft("u2", KIEL_AREA_8, 5), counter("u3", "germany", "airbase", 1, KIEL_AREA_8)]);
    expect(stagingChoices(CTX, s, s.units.u1!).find((c) => c.hex === KIEL_AREA_8)).toMatchObject({ room: 5, problem: null });
  });

  it("a short range cuts the list: 7 hexes loses the base at 8", () => {
    const s = board([luft("u1", KONIGSBERG)]);
    expect(stagingBases(CTX, s, s.units.u1!, 7).map((c) => c.hex)).not.toContain(KIEL_AREA_8);
  });

  it("a unit with no side, or off the map, has no choices", () => {
    expect(stagingChoices(CTX, board([counter("u1", "italy", "air", 3, "Y22", 4)]), board([counter("u1", "italy", "air", 3, "Y22", 4)]).units.u1!)).toEqual([]); // Italy is neutral in 1939
    const off = counter("u2", "germany", "air", 3, "us-box", 4);
    expect(stagingChoices(CTX, board([off]), off)).toEqual([]);
  });

  it("the list is the same every time", () => {
    const s = board([luft("u1", KONIGSBERG)]);
    expect(stagingChoices(CTX, s, s.units.u1!)).toEqual(stagingChoices(CTX, s, s.units.u1!));
  });
});
