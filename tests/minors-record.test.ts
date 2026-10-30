import { describe, expect, it } from "vitest";
import { derivedMinorControl, initialMinorRecords, type MinorCountryState } from "../src/engine/minors-record";
import { MINOR_COUNTRIES } from "../src/engine/minors-rules";
import { OWNER_NAMES } from "../src/engine/nations";

// Spec 15 C1/R9; Ref 17.0–17.3 and Ops 9.0. No live scenario integration in this ticket.
describe("opening minor records (spec 15 C1/R9)", () => {
  it.each(["1939", "campaign"] as const)("%s records Poland and exactly four sleeping German allies", (scenario) => {
    expect(initialMinorRecords(scenario)).toEqual({
      countries: { poland: { status: "attacked", attacker: "germany" } },
      minorAllies: ["finland", "hungary", "rumania", "bulgaria"].map((owner) => ({ owner, of: "germany", active: false })),
    });
  });
  it("returns independent records and ally entries for each game (C1)", () => {
    const first = initialMinorRecords("1939");
    first.countries.poland!.status = "neutral";
    first.minorAllies[0]!.active = true;
    first.minorAllies.pop();
    expect(initialMinorRecords("1939")).toEqual(initialMinorRecords("campaign"));
    expect(initialMinorRecords("1939").minorAllies).toHaveLength(4);
    expect(initialMinorRecords("1939").countries.poland!.status).toBe("attacked");
  });
});

describe("derived minor control (spec 15 C1; Ref 16.0)", () => {
  it.each(MINOR_COUNTRIES)("%s controls its own land when attacked or allied (C1)", (minor) => {
    for (const status of ["attacked", "allied"] as const) {
      const state = { countries: { [minor]: { status } } };
      const before = JSON.stringify(state);
      expect(derivedMinorControl(state, minor)).toBe(minor);
      expect(JSON.stringify(state)).toBe(before);
    }
  });
  it("neutral, sleeping and absent records grant no control, including old saves (C1/R9/R10)", () => {
    expect(derivedMinorControl({}, "poland")).toBeNull();
    expect(derivedMinorControl({ countries: {} }, "finland")).toBeNull();
    expect(derivedMinorControl({ countries: { poland: { status: "neutral" } } }, "poland")).toBeNull();
  });
  it("conquest suppresses fighting-minor control; an unrelated conquest does not (C1/R7)", () => {
    const state: MinorCountryState = { countries: { poland: { status: "attacked" }, belgium: { status: "allied" } }, conquests: [
      { country: "poland", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } },
    ] };
    expect(derivedMinorControl(state, "poland")).toBeNull();
    expect(derivedMinorControl(state, "belgium")).toBe("belgium");
  });
  it("does not derive control for colonies, Eastern Europe, sea or unknown ids (C1/R12)", () => {
    const state: MinorCountryState = { countries: { egypt: { status: "allied" }, "eastern-europe": { status: "attacked" } } };
    for (const country of ["egypt", "eastern-europe", "germany", "unknown", "constructor", "toString", undefined]) {
      expect(derivedMinorControl(state, country)).toBeNull();
    }
  });
});

it("names every minor counter owner and preserves existing owner names (spec 15 B4/C1)", () => {
  expect(Object.keys(OWNER_NAMES)).toEqual(expect.arrayContaining([...MINOR_COUNTRIES, "germany", "free-france", "vichy-france"]));
  const names = ["Arabia", "Belgium", "Bulgaria", "Denmark", "Finland", "Greece", "Hungary", "Ireland", "Luxembourg", "Netherlands", "Norway", "Persia", "Poland", "Portugal", "Rumania", "Spain", "Sweden", "Turkey", "Yugoslavia"];
  expect(MINOR_COUNTRIES.map((minor) => OWNER_NAMES[minor])).toEqual(names);
});
