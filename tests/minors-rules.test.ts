import { describe, expect, it } from "vitest";
import { AXIS_MINOR_ALLIES, AXIS_MINOR_ALLY_WAKE_TURN, COLONIES, DEFENSELESS_MINORS, MINOR_COUNTRIES, MINOR_VALUES, capitalOf, colonyCities, isDefenseless, minorValue, minorValueReading } from "../src/engine/minors-rules";
import { MINOR_COUNTRY_FORCES } from "../src/engine/tables";
import { CTX } from "./helpers";

// Spec 15 R1/R7/R9/R12/R13; Ref 9.2, 14.0, 17.0–17.3, 29.0. Constants and map facts only; no game is changed.
const sum = (countries: readonly string[]) => countries.reduce((n, c) => n + minorValue(c)!, 0);
describe("minor-country values (spec 15 R13; MC12/P8)", () => {
  it("the four Axis allies total 45 and the four Low Countries/Denmark total 40 (Ref 9.2)", () => {
    expect(AXIS_MINOR_ALLIES).toEqual(["finland", "hungary", "rumania", "bulgaria"]);
    expect(sum(AXIS_MINOR_ALLIES)).toBe(45);
    expect(sum(["denmark", "belgium", "netherlands", "luxembourg"])).toBe(40);
    expect(minorValue("poland")).toBe(20); expect(minorValue("eastern-europe")).toBe(25);
  });
  it("covers exactly the chart's nineteen minors, plus colonies and Eastern Europe (R1/R13)", () => {
    expect([...MINOR_COUNTRIES].sort()).toEqual(Object.keys(MINOR_COUNTRY_FORCES).sort());
    expect(Object.keys(MINOR_VALUES).sort()).toEqual([...MINOR_COUNTRIES, ...COLONIES, "eastern-europe"].sort());
  });
  it.each(Object.entries({ norway: 10, sweden: 15, yugoslavia: 20, greece: 10, spain: 30, turkey: 30, portugal: 5, albania: 5, algeria: 5, morocco: 5, tunisia: 5, "lebanon-syria": 5, egypt: 5, palestine: 5 }))("retains the spec's provisional card reading for %s (MC12/P8)", (country, value) => {
    expect(minorValue(country)).toBe(value);
  });
  it.each(["libya", "transjordan", "iraq"])("%s is explicitly unread, not a guessed number (MC12/P8)", (country) => {
    expect(minorValue(country)).toBeNull(); expect(minorValueReading(country)).toBe("not-read");
  });
  it.each(["persia", "arabia", "ireland"])("%s has no printed value (R13), distinct from unread", (country) => {
    expect(minorValue(country)).toBeNull(); expect(minorValueReading(country)).toBe("none-printed");
  });
  it("does not mistake an unknown country or prototype key for a printed zero", () => {
    for (const unknown of ["unknown", "constructor", "toString"]) { expect(minorValue(unknown)).toBeUndefined(); expect(minorValueReading(unknown)).toBeUndefined(); }
  });
});

describe("minor geography and activation facts (spec 15 R1/R7/R9/R12)", () => {
  it("names exactly the five defenseless minors; Eastern Europe separately has no army (R1/R12; MC13)", () => {
    expect(DEFENSELESS_MINORS).toEqual(["arabia", "ireland", "luxembourg", "persia", "portugal"]);
    for (const country of MINOR_COUNTRIES) expect(isDefenseless(country)).toBe(["arabia", "ireland", "luxembourg", "persia", "portugal"].includes(country));
    expect(isDefenseless("eastern-europe")).toBe(true); expect(isDefenseless("unknown")).toBe(false);
  });
  it("pins the wake-up to Axis step 2 of Summer 1941 (R9; MC9)", () => {
    expect(AXIS_MINOR_ALLY_WAKE_TURN).toEqual({ year: 1941, season: "summer", side: "axis", step: "2" });
  });
  it.each(Object.entries({ arabia: null, belgium: "M25", bulgaria: "Y30", denmark: "I32", finland: "D41", greece: "DD28", hungary: "S30", ireland: "H22", luxembourg: "O25", netherlands: "K26", norway: "C35", persia: null, poland: "M35", portugal: "V8", rumania: "W33", spain: "V12", sweden: "E38", turkey: "AA36", yugoslavia: "V29" }))("reads %s's capital from the real map (R7; Luxembourg MC7)", (country, capital) => {
    expect(capitalOf(CTX, country)).toBe(capital);
  });
  it.each(Object.entries({ albania: ["AA26", "Z27"], algeria: ["CC12", "CC9", "DD14"], egypt: ["LL29", "LL31", "MM29", "MM30"], iraq: ["EE42", "HH39"], "lebanon-syria": ["EE38", "HH35", "HH36"], libya: ["II17", "KK18", "KK21", "KK24"], morocco: ["DD3", "EE2"], palestine: ["JJ34", "KK34"], transjordan: ["KK35"], tunisia: ["DD17"] }))("lists all map cities of %s, including ports/capitals (R7/R13)", (country, cities) => {
    expect(colonyCities(CTX, country as (typeof COLONIES)[number])).toEqual(cities);
  });
});
