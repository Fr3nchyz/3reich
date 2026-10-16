import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { airbasesAt, airBasesOf, airCapacity, airFactorsAt, airRoom, baseBan, baseProblem, citiesAt, isAirBase, mayBaseAt, nationOf } from "../src/engine/air-bases";
import { AIRDROP_RANGE, AIR_PER_AIRBASE, AIR_PER_CITY, ANGLO_FRENCH_BASE_BAN_UNTIL, CAPITAL_AIR_MAX, DOUBLE_CITY_HEXES, MISSION_RANGE, STAGING_RANGE } from "../src/engine/air-rules";
import { stackingProblem } from "../src/engine/placement";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 09 R1 and R3 (Ref 20.1, 5.0, 4.7, 33.0, 26.0): what a hex bases, who may use which base, the base lists.
const LONDON = "K23"; // capital
const PARIS = "O22"; // capital
const BERLIN = "L31"; // capital
const WARSAW = "M35";
const LODZ = "N33"; // a Polish city
const MALTA = "GG19";
const MOSCOW = "H47";
const PLAIN = "M34"; // plain hex, no city (stacking.test.ts uses it too)
const air = (id: string, owner: "germany" | "britain" | "france" | "ussr" | "usa" | "italy", at: string, strength = 3, nationality?: "italy") => ({
  ...counter(id, owner, "air", strength, at, 4),
  ...(nationality ? { nationality } : {}),
});
const base = (id: string, owner: "germany" | "britain", at: string) => counter(id, owner, "airbase", 1, at);

describe("constants (Ref 20.1, 20.2, 20.41, 23.1)", () => {
  it("names the rule numbers: 5 per city, 5 per airbase, capital cap 10, stage 8, mission 4, airdrop 6", () => {
    expect([AIR_PER_CITY, AIR_PER_AIRBASE, CAPITAL_AIR_MAX, STAGING_RANGE, MISSION_RANGE, AIRDROP_RANGE, ANGLO_FRENCH_BASE_BAN_UNTIL]).toEqual([5, 5, 10, 8, 4, 6, 1942]);
    expect(DOUBLE_CITY_HEXES).toEqual([]); // TODO(verify): none are on the map data
  });
});

describe("capacity: 5 air factors per city, 5 per airbase counter (Ref 20.1, 5.0)", () => {
  it("a city holds 5 and a plain hex with no airbase is no base at all", () => {
    const s = board([]);
    expect(airCapacity(CTX, s, LODZ)).toBe(5);
    expect(citiesAt(CTX, LODZ)).toBe(1);
    expect(airCapacity(CTX, s, PLAIN)).toBe(0);
    expect(isAirBase(CTX, s, PLAIN)).toBe(false);
    expect(airCapacity(CTX, s, "A24")).toBe(0); // open sea
    expect(airCapacity(CTX, s, "ZZ99")).toBe(0); // off the map
  });

  it("an airbase counter makes a plain hex a 5-factor base and a city a 10-factor one (Ref 20.1)", () => {
    expect(airCapacity(CTX, board([base("u1", "germany", PLAIN)]), PLAIN)).toBe(5);
    expect(airCapacity(CTX, board([base("u1", "germany", LODZ)]), LODZ)).toBe(10);
    expect(airbasesAt(board([base("u1", "germany", LODZ), base("u2", "germany", PLAIN)]), LODZ)).toBe(1);
  });

  it("a Capital holding three airbases still bases at most 10 (Ref 20.1)", () => {
    const three = board([base("u1", "germany", BERLIN), base("u2", "germany", BERLIN), base("u3", "germany", BERLIN)]);
    expect(airCapacity(CTX, board([]), BERLIN)).toBe(5);
    expect(airCapacity(CTX, board([base("u1", "germany", BERLIN)]), BERLIN)).toBe(10);
    expect(airCapacity(CTX, three, BERLIN)).toBe(10);
    // a city that is not a Capital has no such cap in this build: five per airbase counter, however many (only one fits a hex by Ref 20.1)
    expect(airCapacity(CTX, board([base("u1", "germany", LODZ), base("u2", "germany", LODZ)]), LODZ)).toBe(15);
  });

  it("Malta bases only 5 (Ref 33.0): it is one city on the map", () => {
    expect(airCapacity(CTX, board([]), MALTA)).toBe(5);
  });

  it("room is capacity less the air factors standing there, never below 0", () => {
    const s = board([air("u1", "germany", LODZ, 3), air("u2", "britain", LODZ, 1)]);
    expect(airFactorsAt(s, LODZ)).toBe(4);
    expect(airRoom(CTX, s, LODZ)).toBe(1);
    expect(airRoom(CTX, board([air("u1", "germany", LODZ, 5), air("u2", "germany", LODZ, 5)]), LODZ)).toBe(0);
    expect(airRoom(CTX, board([air("u1", "germany", PLAIN, 3)]), PLAIN)).toBe(0);
  });
});

describe("stackingProblem uses the capacity (Ref 5.0, 20.1)", () => {
  const spec = (strength: number) => ({ type: "air" as const, strength });
  it("a city with an airbase takes 10 air factors: 6 now fit with 4 there, 7 do not", () => {
    const s = board([base("u0", "germany", LODZ), air("u1", "germany", LODZ, 5), air("u2", "germany", LODZ, 3)]);
    expect(stackingProblem(CTX, s, "germany", spec(2), LODZ)).toBeNull();
    expect(stackingProblem(CTX, s, "germany", spec(3), LODZ)).toBe(`${LODZ} would hold 11 air factors (limit 10).`);
  });
  it("a plain city still stops at 5, with the old message", () => {
    const s = board([air("u1", "germany", LODZ, 3)]);
    expect(stackingProblem(CTX, s, "germany", spec(2), LODZ)).toBeNull();
    expect(stackingProblem(CTX, s, "germany", spec(3), LODZ)).toBe(`${LODZ} would hold 6 air factors (limit 5).`);
  });
  it("a hex that is no base keeps the flat limit of 5 (suitsBase decides whether air may be there)", () => {
    expect(stackingProblem(CTX, board([air("u1", "germany", PLAIN, 3)]), "germany", spec(3), PLAIN)).toBe(`${PLAIN} would hold 6 air factors (limit 5).`);
  });
});

describe("nationality of a base (Ref 20.1, 26.0)", () => {
  it("British and French air may not use each other's bases before 1942, after that they may", () => {
    const early = board([air("u1", "britain", PARIS), air("u2", "france", LONDON)]);
    expect(mayBaseAt(CTX, early, early.units.u1!, PARIS)).toBe(false);
    expect(baseProblem(CTX, early, early.units.u1!, PARIS)).toBe("British and French air may not use each other's bases before 1942.");
    expect(mayBaseAt(CTX, early, early.units.u2!, LONDON)).toBe(false);
    expect(mayBaseAt(CTX, early, early.units.u1!, LONDON)).toBe(true);
    const late = board([air("u1", "britain", PARIS)], undefined, { year: 1942 });
    expect(mayBaseAt(CTX, late, late.units.u1!, PARIS)).toBe(true);
    expect(baseBan({ year: 1941 }, "britain", "france")).not.toBeNull();
    expect(baseBan({ year: 1942 }, "france", "britain")).toBeNull();
  });

  it("Russian and Western Allied air may not use each other's bases, in any year", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([air("u1", "britain", MOSCOW), air("u2", "usa", MOSCOW), air("u3", "ussr", LONDON), air("u4", "ussr", MOSCOW)], SCENARIO_1942);
    expect(baseProblem(ctx, s, s.units.u1!, MOSCOW)).toBe("Russian and Western Allied air may not use each other's bases.");
    expect(mayBaseAt(ctx, s, s.units.u2!, MOSCOW)).toBe(false);
    expect(mayBaseAt(ctx, s, s.units.u3!, LONDON)).toBe(false);
    expect(mayBaseAt(ctx, s, s.units.u4!, MOSCOW)).toBe(true);
    expect(mayBaseAt(ctx, s, s.units.u1!, LONDON)).toBe(true);
  });

  it("Italian units lent to Germany use German bases (no rule bans allies of one side); the nationality printed wins", () => {
    const s = board([air("u1", "germany", BERLIN, 3, "italy")]);
    expect(nationOf(s.units.u1!)).toBe("italy");
    expect(nationOf(air("u2", "germany", BERLIN))).toBe("germany");
    expect(mayBaseAt(CTX, s, s.units.u1!, BERLIN)).toBe(true);
  });
});

describe("what counts as a base the unit may use (Ref 20.1, 4.7)", () => {
  it("refuses a hex that is no base, and a base the other side holds", () => {
    const s = board([air("u1", "germany", BERLIN)]);
    expect(baseProblem(CTX, s, s.units.u1!, PLAIN)).toMatch(/not an air base/);
    expect(baseProblem(CTX, s, s.units.u1!, WARSAW)).toBe(`${WARSAW} is not held by the axis side.`);
    expect(baseProblem(CTX, s, s.units.u1!, BERLIN)).toBeNull();
  });
  it("a captured city passes to the captor's list of bases", () => {
    const s = board([]);
    expect(airBasesOf(CTX, s, "allies")).toContain(WARSAW);
    expect(airBasesOf(CTX, s, "axis")).not.toContain(WARSAW);
    const taken = { ...s, control: { [WARSAW]: "germany" as const } };
    expect(airBasesOf(CTX, taken, "axis")).toContain(WARSAW);
    expect(airBasesOf(CTX, taken, "allies")).not.toContain(WARSAW);
  });
  it("an airbase counter on open ground of its owner is a base of that side", () => {
    const s = board([base("u1", "britain", "J31")]);
    expect(airBasesOf(CTX, s, "allies")).toContain("J31");
    expect(airBasesOf(CTX, s, "axis")).not.toContain("J31");
  });
  it("lists are in hex-id order and hold only bases", () => {
    const list = airBasesOf(CTX, board([]), "axis");
    expect(list).toEqual([...list].sort());
    expect(list.every((h) => CTX.map.hexes[h]!.land)).toBe(true);
    expect(list).toContain(BERLIN);
    expect(list).not.toContain(LONDON);
  });
});
