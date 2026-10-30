import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { areEnemies, controlAfterEntry, controllerOf, controllingSide, sideInWar } from "../src/engine/control";
import { newGame } from "../src/engine/game";
import type { Conquest } from "../src/engine/conquest-record";
import type { CountryRecord } from "../src/engine/minors-record";
import type { GameState, MinorCountry } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 15 C1, C4.1 (ticket 15-1b): the state record, derived control and the side of a fighting minor.
const BELGIUM = "M25"; // a Belgian hex: nobody's land at the start (control.test.ts)
const withCountries = (countries: Partial<Record<MinorCountry, CountryRecord>>, tweak: Partial<GameState> = {}) => board([], SCENARIO_1939, { countries, ...tweak });

describe("opening state (spec 15 C1, R9)", () => {
  it.each([SCENARIO_1939, SCENARIO_CAMPAIGN])("$id records Poland attacked by Germany and four sleeping Axis allies", (scenario) => {
    const s = newGame(scenario, 1);
    expect(s.countries).toEqual({ poland: { status: "attacked", attacker: "germany" } });
    expect(s.minorAllies).toEqual(["finland", "hungary", "rumania", "bulgaria"].map((owner) => ({ owner, of: "germany", active: false })));
    for (const owner of ["finland", "hungary", "rumania", "bulgaria"] as const) expect(sideInWar(s, owner)).toBeNull();
  });

  it("1942 starts without a country record (old saves read the same way)", () => {
    expect(newGame(SCENARIO_1942, 1).countries).toBeUndefined();
  });
});

describe("a fighting minor's land (spec 15 C1, C4.1)", () => {
  it("nobody controls a neutral minor's hex; no record changes nothing", () => {
    expect(controllerOf(CTX, board([]), BELGIUM)).toBeNull();
    expect(controllerOf(CTX, withCountries({ belgium: { status: "neutral" } }), BELGIUM)).toBeNull();
  });

  it("an attacked minor controls its own land and fights opposite the declarer", () => {
    const s = withCountries({ belgium: { status: "attacked", attacker: "germany" } });
    expect(controllerOf(CTX, s, BELGIUM)).toBe("belgium");
    expect(sideInWar(s, "belgium")).toBe("allies");
    expect(controllingSide(CTX, s, BELGIUM)).toBe("allies");
    expect(areEnemies(s, "germany", "belgium")).toBe(true);
    expect(sideInWar(withCountries({ belgium: { status: "attacked", attacker: "britain" } }), "belgium")).toBe("axis");
  });

  it("a helped minor fights on its helper's side", () => {
    const s = withCountries({ belgium: { status: "allied", attacker: "germany", helpers: ["britain"] } });
    expect(controllerOf(CTX, s, BELGIUM)).toBe("belgium");
    expect(sideInWar(s, "belgium")).toBe("allies");
    expect(sideInWar(withCountries({ belgium: { status: "allied", attacker: "germany" } }), "belgium")).toBeNull();
  });

  it("spec 14's conquest record and an explicit control entry both beat the derived control", () => {
    const record = { belgium: { status: "attacked", attacker: "germany" } } as const;
    const conquered = withCountries(record, { conquests: [{ country: "belgium", by: "germany" } as unknown as Conquest] });
    expect(controllerOf(CTX, conquered, BELGIUM)).toBeNull();
    expect(controllerOf(CTX, withCountries(record, { control: { [BELGIUM]: "germany" } }), BELGIUM)).toBe("germany");
  });

  it("a hex of another country, and sea, stay out of the derived control", () => {
    const s = withCountries({ belgium: { status: "attacked", attacker: "germany" } });
    expect(controllerOf(CTX, s, "L31")).toBe("germany");
  });

  it("an enemy ground unit entering an attacked minor's hex takes it; a friendly one does not (Ref 7.0)", () => {
    const s = withCountries({ belgium: { status: "attacked", attacker: "germany" } });
    expect(controlAfterEntry(CTX, s, counter("g", "germany", "infantry", 3, BELGIUM, 3), BELGIUM)).toBe("germany");
    expect(controlAfterEntry(CTX, s, counter("b", "britain", "infantry", 3, BELGIUM, 3), BELGIUM)).toBeNull();
  });
});
