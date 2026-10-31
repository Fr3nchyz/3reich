import { describe, expect, it } from "vitest";
import { ORIGINAL_ZONES } from "../src/data/gamedata";
import { createEasternEurope, easternEuropeCountryOf, easternEuropeDeclarationProblem,
  EASTERN_EUROPE_HEXES, EASTERN_POLISH_HEXES, EASTERN_EUROPE_VALUE,
  MC13_EASTERN_EUROPE_ARMY, MC13_EASTERN_EUROPE_CONTROLLER, MC13_POLISH_REMOVAL_AT_CREATION,
  MC13_SIDE_DECLARERS } from "../src/engine/minors-east";
import { MINOR_VALUES } from "../src/engine/minors-rules";
import { controllerOf } from "../src/engine/control";
import type { GameState } from "../src/engine/types";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

const opening = (): GameState => at6f([], "axis", undefined, { year: 1939, season: "fall" });
const created = (): GameState => ({ ...createEasternEurope(opening()), activeSide: "allies" });

describe("spec 15 R12: pure Eastern Europe", () => {
  it("R12: pins the complete land and Polish partition against repository data", () => {
    const land = ORIGINAL_ZONES["eastern-europe"].filter((h) => ["poland", "rumania", "baltic-states"].includes(CTX.map.hexes[h]?.country ?? ""));
    expect([...EASTERN_EUROPE_HEXES].sort()).toEqual([...land].sort());
    expect([...EASTERN_POLISH_HEXES].sort()).toEqual([...CTX.scenario.zones["poland-east-of-partition-line"]!.hexes!].sort());
    expect(new Set(EASTERN_EUROPE_HEXES).size).toBe(EASTERN_EUROPE_HEXES.length);
  });

  it("R12 / MC13: creates a neutral defenseless country, value 25, with nobody controlling its whole land", () => {
    const state = opening();
    state.control = { J38: "germany", R35: "rumania", L32: "germany" };
    state.countries = { poland: { status: "attacked", attacker: "germany" }, ireland: { status: "neutral" } };
    const before = structuredClone(state);
    const next = createEasternEurope(state);
    expect(next.countries).toEqual({ ...state.countries, "eastern-europe": { status: "neutral" } });
    expect(EASTERN_EUROPE_VALUE).toBe(25);
    expect(MINOR_VALUES.poland).toBe(20);
    expect(MINOR_VALUES.rumania).toBe(15);
    expect(MC13_EASTERN_EUROPE_ARMY).toEqual([]);
    expect(MC13_EASTERN_EUROPE_CONTROLLER).toBeNull();
    expect(next.units).toEqual(state.units);
    for (const hex of EASTERN_EUROPE_HEXES) {
      expect(next.control[hex]).toBeNull();
      expect(controllerOf(CTX, next, hex)).toBeNull();
      expect(easternEuropeCountryOf(CTX, next, hex)).toBe("eastern-europe");
      expect(easternEuropeCountryOf(CTX, state, hex)).toBe(CTX.map.hexes[hex]!.country);
    }
    expect(next.control.L32).toBe("germany");
    expect(easternEuropeCountryOf(CTX, next, "L32")).toBe(CTX.map.hexes.L32!.country);
    expect(easternEuropeCountryOf(CTX, next, "missing")).toBeUndefined();
    expect(next).toEqual({ ...state, control: next.control, countries: next.countries });
    expect(state).toEqual(before);
  });

  it("R12: creation is limited to Axis Fall 1939, leaving scheduling within that turn to the caller", () => {
    for (const tweak of [{ year: 1940 }, { year: 1938 }, { season: "spring" }, { season: "summer" }, { season: "winter" }, { activeSide: "allies" }] as Partial<GameState>[]) {
      const state = { ...opening(), ...tweak };
      expect(createEasternEurope(state)).toBe(state);
    }
  });

  it("R12: old saves work and repeat calls preserve later control and country changes by identity", () => {
    const state = opening();
    delete state.countries;
    const next = createEasternEurope(state);
    expect(next.countries?.["eastern-europe"]).toEqual({ status: "neutral" });
    const changed: GameState = { ...next, control: { J38: "ussr" }, countries: { "eastern-europe": { status: "attacked", attacker: "ussr" } } };
    expect(createEasternEurope(changed)).toBe(changed);
    expect(easternEuropeCountryOf(CTX, changed, "R35")).toBe("eastern-europe");
  });

  it("R12 / MC13 / errata: removes only Polish counters east of the line, without returning them or changing other records", () => {
    expect(MC13_POLISH_REMOVAL_AT_CREATION).toBe(true);
    const units = EASTERN_POLISH_HEXES.map((hex, i) => inf(`p${i}`, "poland", hex));
    const state = { ...opening(), units: Object.fromEntries([...units,
      inf("west", "poland", "L37"), inf("baltic", "poland", "E40"), inf("bess", "poland", "R35"),
      inf("german", "germany", "J38"), { ...inf("national", "britain", "K38"), nationality: "poland" as const },
    ].map((u) => [u.id, u])) };
    const before = structuredClone(state);
    const next = createEasternEurope(state);
    expect(Object.keys(next.units).sort()).toEqual(["west", "baltic", "bess", "german"].sort());
    for (const id of Object.keys(next.units)) expect(next.units[id]).toEqual(state.units[id]);
    expect(next.pools).toEqual(state.pools);
    expect(next.nations).toEqual(state.nations);
    expect(next.wars).toEqual(state.wars);
    expect(state).toEqual(before);
  });

  it("R12: a recorded Polish conquest suppresses Polish removal but does not prevent creation", () => {
    const state = opening();
    state.units = { p: inf("p", "poland", "J39") };
    state.conquests = [{ country: "poland", by: "germany", side: "allies", at: { year: 1939, season: "fall" }, how: "capital" }];
    const next = createEasternEurope(state);
    expect(next.units).toEqual(state.units);
    expect(next.conquests).toEqual(state.conquests);
    expect(next.countries?.["eastern-europe"]?.status).toBe("neutral");
  });

  it("R12: missing country, German date, and Soviet Allied Fall date gates", () => {
    expect(easternEuropeDeclarationProblem(CTX, opening(), "germany")).toMatch(/not been created/);
    expect(easternEuropeDeclarationProblem(CTX, created(), "germany")).toMatch(/1940/);
    expect(easternEuropeDeclarationProblem(CTX, { ...created(), year: 1940 }, "germany")).toBeNull();
    for (const season of ["spring", "summer"] as const) expect(easternEuropeDeclarationProblem(CTX, { ...created(), season }, "ussr")).not.toBeNull();
    expect(easternEuropeDeclarationProblem(CTX, { ...created(), year: 1938 }, "ussr")).not.toBeNull();
    expect(easternEuropeDeclarationProblem(CTX, { ...created(), activeSide: "axis" }, "ussr")).toMatch(/Allied Fall/);
    expect(easternEuropeDeclarationProblem(CTX, created(), "ussr")).toBeNull();
    expect(easternEuropeDeclarationProblem(CTX, { ...created(), season: "winter" }, "ussr")).toBeNull();
    expect(MC13_SIDE_DECLARERS).toEqual({ axis: "germany", allies: "ussr" });
    expect(easternEuropeDeclarationProblem(CTX, created(), "axis")).not.toBeNull();
    expect(easternEuropeDeclarationProblem(CTX, created(), "allies")).toBeNull();
  });

  it("R12: ordinary country restrictions remain effective", () => {
    const state = { ...created(), year: 1940 };
    expect(easternEuropeDeclarationProblem(CTX, { ...state, countries: { "eastern-europe": { status: "attacked" } } }, "germany")).not.toBeNull();
    expect(easternEuropeDeclarationProblem({ ...CTX, scenario: { ...CTX.scenario, rules: [{ kind: "no-war-on-neutrals" }] } }, state, "germany")).not.toBeNull();
    const conquered: GameState = { ...state, conquests: [{ country: "eastern-europe", by: "ussr", side: "axis", at: { year: 1939, season: "winter" }, how: "all-cities" }] };
    expect(easternEuropeDeclarationProblem(CTX, conquered, "germany")).not.toBeNull();
    expect(easternEuropeCountryOf(CTX, conquered, "R35")).toBe("eastern-europe");
    expect(easternEuropeDeclarationProblem(CTX, { ...state, wars: [["germany", "eastern-europe"]] } as unknown as GameState, "germany")).not.toBeNull();
  });
});
