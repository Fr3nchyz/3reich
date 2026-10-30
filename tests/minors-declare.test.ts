import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { declarationCost, minorDeclarationProblem } from "../src/engine/minors-declare";
import { applyDeclaration, declarationTargets } from "../src/engine/war";
import type { GameState } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

const start = () => atStart(SCENARIO_1939, 1);
const problem = (s: GameState, country = "denmark") => minorDeclarationProblem(CTX, s, "germany", country);

describe("spec 15 R2 declarations and R3/R4 records", () => {
  it("R1/R2: accepts neutral chart minors, rejects non-minors and fighting Poland", () => {
    expect(problem(start())).toBeNull();
    for (const country of ["switzerland", "usa", "iraq", "poland"]) expect(problem(start(), country)).not.toBeNull();
    expect(problem({ ...start(), countries: undefined }, "poland")).not.toBeNull();
  });

  it("R2/R9: sleeping allies are declarable; active allies are excluded", () => {
    const s = start();
    for (const minor of ["finland", "hungary", "rumania", "bulgaria"]) {
      expect(problem(s, minor)).toBeNull();
      expect(declarationTargets(CTX, s, "germany")).toContain(minor);
      expect(problem({ ...s, minorAllies: s.minorAllies.map((m) => ({ ...m, active: true })) }, minor)).not.toBeNull();
    }
  });

  it("R2: rejects attacked, allied and conquered minors, including old saves without records", () => {
    for (const status of ["attacked", "allied"] as const) expect(problem({ ...start(), countries: { denmark: { status } } })).not.toBeNull();
    expect(problem({ ...start(), countries: undefined })).toBeNull();
    expect(problem({ ...start(), conquests: [{ country: "denmark", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } }] })).not.toBeNull();
  });

  it("R2: respects the scenario's neutral-war prohibition", () => {
    const ctx = { ...CTX, scenario: { ...CTX.scenario, rules: [{ kind: "no-war-on-neutrals" as const }] } };
    expect(minorDeclarationProblem(ctx, start(), "germany", "denmark")).not.toBeNull();
    expect(declarationTargets(ctx, start(), "germany")).not.toContain("denmark");
  });

  it("R2/R12: Eastern Europe requires creation and respects both date boundaries", () => {
    const s: GameState = { ...start(), countries: { "eastern-europe": { status: "neutral" } } };
    expect(problem(start(), "eastern-europe")).not.toBeNull();
    expect(problem(s, "eastern-europe")).not.toBeNull();
    expect(problem({ ...s, year: 1940, season: "spring" }, "eastern-europe")).toBeNull();
    expect(minorDeclarationProblem(CTX, { ...s, season: "summer" }, "ussr", "eastern-europe")).not.toBeNull();
    expect(minorDeclarationProblem(CTX, s, "ussr", "eastern-europe")).toBeNull();
  });

  it("R10/R11: respects recorded Garrison bans and the open Persian route", () => {
    expect(problem({ ...start(), countries: { denmark: { status: "neutral", closedTo: ["germany"] } } })).not.toBeNull();
    expect(problem({ ...start(), countries: { denmark: { status: "neutral", closedTo: ["britain"] } } })).toBeNull();
    expect(problem({ ...start(), countries: { persia: { status: "neutral", opened: true } } }, "persia")).not.toBeNull();
  });

  it("R2/MC4/MC14: costs 10 ordinarily (including Persia and sleeping allies), 35 for a new protecting-power war", () => {
    const s = { ...start(), wars: [] };
    for (const country of ["denmark", "persia", "hungary"]) expect(declarationCost(CTX, s, "germany", country)).toBe(10);
    expect(declarationCost(CTX, s, "germany", "britain")).toBe(35);
    const allied: GameState = { ...s, countries: { turkey: { status: "allied", helpers: ["britain", "france"] } } };
    expect(declarationCost(CTX, allied, "germany", "turkey")).toBe(35);
    expect(declarationCost(CTX, { ...allied, wars: [["germany", "britain"], ["germany", "france"]] }, "germany", "turkey")).toBe(10);
    const active = { ...s, minorAllies: [{ owner: "hungary" as const, of: "germany" as const, active: true }] };
    expect(declarationCost(CTX, active, "britain", "hungary")).toBe(35);
  });

  it("R2/R3/R4/C1: records the attacker, opposite placing side, turn and duty, charging only once immutably", () => {
    const s = start();
    const before = structuredClone(s);
    const r = applyDeclaration(CTX, s, { type: "DECLARE_WAR", by: "germany", on: "denmark" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.countries?.denmark).toEqual({ status: "attacked", attacker: "germany", toPlace: "allies", duty: { by: "germany", declared: { year: 1939, season: "fall" } } });
    expect(r.state.countries?.poland).toEqual(s.countries?.poland);
    expect(r.state.wars).toContainEqual(["germany", "denmark"]);
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal - 10);
    expect(applyDeclaration(CTX, r.state, { type: "DECLARE_WAR", by: "germany", on: "denmark" }).ok).toBe(false);
    expect(s).toEqual(before);
    const allies = applyDeclaration(CTX, { ...s, activeSide: "allies" }, { type: "DECLARE_WAR", by: "britain", on: "hungary" });
    expect(allies.ok && allies.state.countries?.hungary?.toPlace).toBe("axis");
  });

  it("R1/R3: defenseless minors have a duty but no placement", () => {
    for (const on of ["arabia", "ireland", "luxembourg", "persia", "portugal"] as const) {
      const r = applyDeclaration(CTX, start(), { type: "DECLARE_WAR", by: "germany", on });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.state.countries?.[on]?.toPlace).toBeUndefined();
      expect(r.state.countries?.[on]?.duty?.by).toBe("germany");
    }
  });

  it("R2: refuses an unaffordable minor declaration and leaves Major-Power targets unchanged", () => {
    const s = start();
    const poor = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, spent: 66 } } };
    expect(declarationTargets(CTX, poor, "germany")).not.toContain("denmark");
    expect(applyDeclaration(CTX, poor, { type: "DECLARE_WAR", by: "germany", on: "denmark" }).ok).toBe(false);
    expect(declarationTargets(CTX, s, "germany")).toContain("ussr");
    expect(declarationTargets(CTX, s, "germany")).not.toContain("italy");
  });
});
