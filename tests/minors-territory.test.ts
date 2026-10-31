import { describe, expect, it } from "vitest";
import { newGame } from "../src/engine/game";
import { territoryIncome } from "../src/engine/minors-income";
import { capitalOf } from "../src/engine/minors-rules";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import type { GameState } from "../src/engine/types";
import { CTX, ctxFor } from "./helpers";

const base = (): GameState => ({ ...newGame(CTX.scenario, 1), year: 1940, units: {}, control: {}, conquests: [], countries: {} });
const helped = (): GameState => ({ ...base(), countries: { belgium: { status: "allied", attacker: "germany", helpers: ["britain", "france"] } } });
const conquest = { country: "belgium", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } } as const;

describe("territory income (spec 15 R13)", () => {
  it("R13 pays no sleeping allies and tolerates old saves", () => {
    expect(territoryIncome(CTX, { ...base(), countries: undefined, conquests: undefined }, "germany")).toEqual({ lines: [], total: 0 });
  });
  it("R13 pays each active ally to its protector by value", () => {
    const s = { ...base(), minorAllies: base().minorAllies.map((a) => ({ ...a, active: a.owner === "rumania" })) };
    expect(territoryIncome(CTX, s, "germany")).toEqual({ lines: [{ country: "rumania", kind: "minor-ally", brps: 15 }], total: 15 });
    expect(territoryIncome(CTX, s, "britain").total).toBe(0);
  });
  it.each([SCENARIO_1942, SCENARIO_1944])("R13 retains the printed starting-allies exception in $id", (scenario) => {
    expect(territoryIncome(ctxFor(scenario), newGame(scenario, 1), "germany").total).toBe(45);
  });
  it("R13/MC19 pays the first helper once without mutation", () => {
    const s = helped();
    const before = structuredClone(s);
    const result = territoryIncome(CTX, s, "britain");
    expect(result).toEqual({ lines: [{ country: "belgium", kind: "helped-minor", brps: 15 }], total: 15 });
    expect(territoryIncome(CTX, s, "france").total).toBe(0);
    expect(territoryIncome(CTX, s, "britain")).toEqual(result);
    expect(s).toEqual(before);
  });
  it("R13 requires an allied record with a helper", () => {
    for (const record of [{ status: "neutral" as const, helpers: ["britain" as const] }, { status: "attacked" as const, helpers: ["britain" as const] }, { status: "allied" as const }]) {
      expect(territoryIncome(CTX, { ...base(), countries: { belgium: record }, control: { M25: "britain" } }, "britain").total).toBe(0);
    }
  });
  it("R13/MC20 rejects lost and unheld capitals, but accepts a friendly power", () => {
    const capital = capitalOf(CTX, "belgium")!;
    for (const owner of ["germany", null] as const) expect(territoryIncome(CTX, { ...helped(), control: { [capital]: owner } }, "britain").total).toBe(0);
    expect(territoryIncome(CTX, { ...helped(), control: { [capital]: "france" } }, "britain").total).toBe(15);
  });
  it("R13/MC20 stops helper payment even for conquest completed this year", () => {
    expect(territoryIncome(CTX, { ...helped(), control: { M25: "britain" }, conquests: [{ ...conquest, at: { year: 1940, season: "winter" } }] }, "britain")).toEqual({ lines: [], total: 0 });
  });
  it("R13 delegates conquered income with dates and current holders", () => {
    const s = { ...base(), conquests: [conquest], control: { M25: "germany" as const } };
    expect(territoryIncome(CTX, s, "germany")).toEqual({ lines: [{ country: "belgium", kind: "conquered", brps: 15 }], total: 15 });
    expect(territoryIncome(CTX, { ...s, year: 1939 }, "germany").total).toBe(0);
    expect(territoryIncome(CTX, { ...s, control: { M25: "britain" } }, "britain").total).toBe(15);
  });
  it("R13 sums mixed lines and excludes conquered active allies", () => {
    const s: GameState = { ...helped(), minorAllies: [{ owner: "rumania", of: "britain", active: true }] };
    expect(territoryIncome(CTX, s, "britain").total).toBe(30);
    expect(territoryIncome(CTX, { ...s, conquests: [{ ...conquest, country: "rumania" }] }, "britain").total).toBe(15);
  });
  it("R13 excludes starting holdings for helpers and conquests without loss charges", () => {
    const s: GameState = { ...base(), countries: { poland: { status: "allied", helpers: ["britain"] } }, conquests: [{ ...conquest, country: "algeria" }] };
    expect(territoryIncome(CTX, s, "britain")).toEqual({ lines: [], total: 0 });
    expect(territoryIncome(CTX, s, "france")).toEqual({ lines: [], total: 0 });
  });
  it("R13 counts an active ally only once when a helper record overlaps", () => {
    const s: GameState = { ...base(), minorAllies: [{ owner: "belgium", of: "britain", active: true }], countries: helped().countries };
    expect(territoryIncome(CTX, s, "britain")).toEqual({ lines: [{ country: "belgium", kind: "minor-ally", brps: 15 }], total: 15 });
  });
  it("R13 leaves Major Power and Soviet-city lines to spec 14", () => {
    const s: GameState = { ...base(), conquests: [{ ...conquest, country: "france", startingBrps: 85 }], control: { P20: "germany" } };
    expect(territoryIncome(CTX, s, "germany")).toEqual({ lines: [], total: 0 });
  });
  it("R13/MC20 withholds helper income without a known capital", () => {
    const s: GameState = { ...base(), countries: { persia: { status: "allied", helpers: ["britain"] } } };
    expect(territoryIncome(CTX, s, "britain")).toEqual({ lines: [], total: 0 });
  });
  it("R13/MC12 retains blank values as zero lines", () => {
    const s: GameState = { ...base(), countries: { ireland: { status: "allied", helpers: ["britain"] } }, control: { [capitalOf(CTX, "ireland")!]: "britain" } };
    expect(territoryIncome(CTX, s, "britain")).toEqual({ lines: [{ country: "ireland", kind: "helped-minor", brps: 0 }], total: 0 });
  });
});
