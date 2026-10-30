import { describe, expect, it } from "vitest";
import { newGame } from "../src/engine/game";
import { conqueredIncome, conqueredIncomeLines, holdsAllCities, settleAllCitiesConquests } from "../src/engine/minors-income";
import { capitalOf, colonyCities } from "../src/engine/minors-rules";
import { runYearStartSequence } from "../src/engine/yearstart";
import type { GameState } from "../src/engine/types";
import { CTX } from "./helpers";

const base = (): GameState => ({ ...newGame(CTX.scenario, 1), phase: "player-turn", year: 1940, units: {}, conquests: [], control: {} });
const conquered = (): GameState => ({ ...base(), control: { M25: "germany" }, conquests: [{ country: "belgium", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } }] });

describe("conquered income (spec 15 R7/R13)", () => {
  it("R13 pays the table value and exposes the country line", () => {
    expect(conqueredIncome(CTX, conquered(), "germany")).toBe(15);
    expect(conqueredIncomeLines(CTX, conquered(), "germany")).toEqual([{ country: "belgium", value: 15 }]);
  });
  it("R7 requires a completed record, not merely capital control", () => {
    expect(conqueredIncome(CTX, { ...conquered(), conquests: [] }, "germany")).toBe(0);
  });
  it("R13 pays first at the following Year Start", () => {
    expect(conqueredIncome(CTX, { ...conquered(), year: 1939 }, "germany")).toBe(0);
  });
  it("R7 stops after the record is removed or the capital is lost", () => {
    expect(conqueredIncome(CTX, { ...conquered(), control: { M25: null } }, "germany")).toBe(0);
    expect(conqueredIncome(CTX, { ...conquered(), conquests: undefined }, "germany")).toBe(0);
  });
  it("R13 pays the current capital holder rather than the old conqueror", () => {
    const s: GameState = { ...conquered(), control: { M25: "britain" } };
    expect(conqueredIncome(CTX, s, "germany")).toBe(0);
    expect(conqueredIncome(CTX, s, "britain")).toBe(15);
  });
  it("R13 excludes Major Powers", () => {
    const s: GameState = { ...conquered(), conquests: [{ ...conquered().conquests![0]!, country: "france", startingBrps: 85 }] };
    expect(conqueredIncomeLines(CTX, s, "germany")).toEqual([]);
  });
  it("R7/MC7 pays defenseless Luxembourg using its one hex", () => {
    const s: GameState = { ...conquered(), control: { [capitalOf(CTX, "luxembourg")!]: "germany" }, conquests: [{ ...conquered().conquests![0]!, country: "luxembourg" }] };
    expect(conqueredIncome(CTX, s, "germany")).toBe(5);
  });
  it("R13 adds income to Year Start totals, limits and log with a reason", () => {
    const before = runYearStartSequence(CTX, { ...conquered(), conquests: [] });
    const after = runYearStartSequence(CTX, conquered());
    expect(after.state.nations.germany.brpTotal - before.state.nations.germany.brpTotal).toBe(15);
    expect(after.state.nations.germany.spendLimit).toBe(Math.floor(after.state.nations.germany.brpTotal / 2));
    expect(after.events.some((e) => e.type === "BRPS_CHANGED" && e.nation === "germany" && e.reason.includes("belgium: 15"))).toBe(true);
  });
  it("R7/R13 requires every colony city, calls fallCountry once, then pays", () => {
    const cities = colonyCities(CTX, "algeria");
    const s: GameState = { ...base(), control: Object.fromEntries(cities.map((h) => [h, "germany"])) };
    expect(holdsAllCities(CTX, s, "axis", "algeria")).toBe(true);
    expect(holdsAllCities(CTX, { ...s, control: { ...s.control, [cities[0]!]: "britain" } }, "axis", "algeria")).toBe(false);
    const done = settleAllCitiesConquests(CTX, s);
    expect(done.state.conquests?.some((c) => c.country === "algeria" && c.how === "all-cities")).toBe(true);
    expect(settleAllCitiesConquests(CTX, done.state).events).toEqual([]);
    expect(conqueredIncome(CTX, { ...done.state, year: 1941 }, "germany")).toBe(5);
  });
  it("R12/R13 uses Eastern Europe's zone cities and pays 25", () => {
    const cities = colonyCities(CTX, "algeria");
    const ctx = { ...CTX, scenario: { ...CTX.scenario, zones: { ...CTX.scenario.zones, "eastern-europe": { hexes: cities, countries: [], description: "R12 test zone" } } } };
    const s: GameState = { ...base(), control: Object.fromEntries(cities.map((h) => [h, "germany"])) };
    expect(holdsAllCities(ctx, s, "axis", "eastern-europe")).toBe(true);
    expect(holdsAllCities(ctx, { ...s, control: { ...s.control, [cities[0]!]: "britain" } }, "axis", "eastern-europe")).toBe(false);
    const done = settleAllCitiesConquests(ctx, s);
    expect(conqueredIncome(ctx, { ...done.state, year: 1941 }, "germany")).toBe(30);
  });
  it("R13/MC12 unread values pay zero without inventing a card reading", () => {
    const s: GameState = { ...base(), control: Object.fromEntries(colonyCities(CTX, "iraq").map((h) => [h, "germany"])), conquests: [{ ...conquered().conquests![0]!, country: "iraq" }] };
    expect(conqueredIncomeLines(CTX, s, "germany")).toEqual([{ country: "iraq", value: 0 }]);
  });
  it("R13 excludes the side's starting holdings even with a conquest record", () => {
    const s: GameState = { ...base(), conquests: [{ ...conquered().conquests![0]!, country: "algeria" }] };
    expect(conqueredIncome(CTX, s, "france")).toBe(0);
  });
  it("R7/MC13 does not conquer empty city lists or mixed holders", () => {
    expect(holdsAllCities(CTX, base(), "axis", "eastern-europe")).toBe(false);
    const cities = colonyCities(CTX, "algeria");
    const s: GameState = { ...base(), nations: { ...base().nations, italy: { ...base().nations.italy, status: "axis" } }, control: Object.fromEntries(cities.map((h, i) => [h, i ? "germany" : "italy"])) };
    expect(settleAllCitiesConquests(CTX, s).state.conquests).toEqual([]);
  });
});
