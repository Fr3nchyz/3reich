import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { MC21_USSR_BORDER_MINORS, minorDeclarationProblem } from "../src/engine/minors-declare";
import { sideInWar } from "../src/engine/control";
import { applyDeclaration, declarationTargets, legalDeclarations, legalNeutralDeclarations } from "../src/engine/war";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

const start = () => atStart(SCENARIO_1939, 1);
const axis = () => start();
const allies = (): GameState => ({ ...start(), activeSide: "allies" });
const garrison = (s: GameState, hex: string): GameState => ({ ...s, units: { ...s.units, g1: { id: "g1", owner: "germany", type: "infantry", at: hex, strength: 1, movement: 3 } as unknown as Unit } });
const hexOf = (country: string) => Object.values(MAP.hexes).find((h) => h.land && h.country === country)!.id;

describe("spec 15 R2 / MC21: a neutral Major Power declares on minors only", () => {
  it("Italy, neutral, declares on a minor on the Axis turn, pays 10 and stays neutral", () => {
    const s = axis();
    expect(s.nations.italy.status).toBe("neutral");
    const targets = declarationTargets(CTX, s, "italy");
    expect(targets).toContain("greece");
    expect(targets.filter((t) => ["britain", "france", "ussr", "germany", "usa"].includes(t))).toEqual([]);
    const r = applyDeclaration(CTX, s, { type: "DECLARE_WAR", by: "italy", on: "greece" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.nations.italy.status).toBe("neutral");
    expect(r.state.nations.italy.brpTotal).toBe(s.nations.italy.brpTotal - 10);
    expect(r.state.countries?.greece).toMatchObject({ status: "attacked", attacker: "italy", toPlace: "allies" });
    expect(sideInWar(r.state, "greece")).toBe("allies");
    expect(applyDeclaration(CTX, s, { type: "DECLARE_WAR", by: "italy", on: "britain" }).ok).toBe(false);
  });

  it("neutral declarations are listed apart, so step 1 and the computer games stay as they were", () => {
    const s = axis();
    expect(legalDeclarations(CTX, s).some((a) => a.type === "DECLARE_WAR" && (a.by === "italy" || a.by === "ussr"))).toBe(false);
    const neutral = legalNeutralDeclarations(CTX, s);
    expect(neutral).toContainEqual({ type: "DECLARE_WAR", by: "italy", on: "greece" });
    expect(neutral.every((a) => a.type === "DECLARE_WAR" && a.by === "italy")).toBe(true);
  });

  it("a minor attacked by a Vichy declarer takes no side", () => {
    const s = axis();
    const vichy: GameState = { ...s, nations: { ...s.nations, france: { ...s.nations.france, status: "vichy" } }, countries: { denmark: { status: "attacked", attacker: "france" } } };
    expect(sideInWar(vichy, "denmark")).toBeNull();
  });

  it("a neutral Power declares only on its alignment side's turn", () => {
    expect(declarationTargets(CTX, allies(), "italy")).toEqual([]);
    expect(declarationTargets(CTX, axis(), "ussr")).toEqual([]);
    expect(applyDeclaration(CTX, allies(), { type: "DECLARE_WAR", by: "italy", on: "greece" }).ok).toBe(false);
    const r = applyDeclaration(CTX, allies(), { type: "DECLARE_WAR", by: "ussr", on: "finland" });
    expect(r.ok && r.state.nations.ussr.status).toBe("neutral");
    expect(r.ok && r.state.countries?.finland?.toPlace).toBe("axis");
  });
});

describe("spec 15 R2 / MC21: the joint rules of 13.1", () => {
  it("Germany and Italy not on one minor until Italy is at war with the Western Allies", () => {
    const hit: GameState = { ...axis(), countries: { denmark: { status: "attacked", attacker: "germany" } }, wars: [["germany", "denmark"]] };
    expect(minorDeclarationProblem(CTX, hit, "italy", "denmark")).toMatch(/Germany and Italy/);
    const west: GameState = { ...hit, wars: [...hit.wars, ["italy", "britain"]] };
    expect(minorDeclarationProblem(CTX, west, "italy", "denmark")).not.toMatch(/Germany and Italy/);
  });

  it("the U.S.S.R. and the Western Allies not on one minor until Russia is at war with Germany or Italy", () => {
    const hit: GameState = { ...allies(), countries: { finland: { status: "attacked", attacker: "britain" } }, wars: [["britain", "finland"]] };
    expect(minorDeclarationProblem(CTX, hit, "ussr", "finland")).toMatch(/U\.S\.S\.R\. and the Western Allies/);
    const hit2: GameState = { ...allies(), countries: { finland: { status: "attacked", attacker: "ussr" } }, wars: [["ussr", "finland"]] };
    expect(minorDeclarationProblem(CTX, hit2, "britain", "finland")).toMatch(/U\.S\.S\.R\. and the Western Allies/);
    expect(minorDeclarationProblem(CTX, { ...hit, wars: [...hit.wars, ["ussr", "germany"]] }, "ussr", "finland")).not.toMatch(/Western Allies/);
  });

  it("the U.S.S.R. before war: bordering minors only", () => {
    const s = allies();
    for (const c of MC21_USSR_BORDER_MINORS) if (c !== "eastern-europe" && c !== "poland") expect(minorDeclarationProblem(CTX, s, "ussr", c)).toBeNull();
    for (const c of ["denmark", "greece", "bulgaria"]) expect(minorDeclarationProblem(CTX, s, "ussr", c)).toMatch(/bordering/);
    expect(minorDeclarationProblem(CTX, { ...s, wars: [["ussr", "germany"]] }, "ussr", "greece")).toBeNull();
    // after it has conquered Rumania it may declare on a neighbour of Rumania
    const fell: GameState = { ...s, conquests: [{ country: "rumania", by: "ussr", side: "axis", how: "capital", at: { year: 1940, season: "fall" } }] };
    expect(minorDeclarationProblem(CTX, fell, "ussr", "bulgaria")).toBeNull();
    expect(minorDeclarationProblem(CTX, fell, "ussr", "greece")).toMatch(/bordering/);
  });

  it("a German ground factor in an Axis Minor-Ally bars the U.S.S.R. unless it is at war with Germany", () => {
    const s = garrison(allies(), hexOf("finland"));
    expect(minorDeclarationProblem(CTX, s, "ussr", "finland")).toMatch(/Garrison/);
    expect(minorDeclarationProblem(CTX, s, "britain", "finland")).toBeNull();
    expect(minorDeclarationProblem(CTX, { ...s, wars: [["ussr", "germany"]] }, "ussr", "finland")).toBeNull();
    expect(minorDeclarationProblem(CTX, garrison(allies(), hexOf("turkey")), "ussr", "turkey")).toBeNull();
  });

  it("MC21_USSR_BORDER_MINORS is the map's land border of the U.S.S.R. (minors and Eastern Europe)", () => {
    const found = new Set<string>();
    for (const [key, side] of Object.entries(MAP.hexsides)) {
      if (!side.land) continue;
      const [a, b] = key.split("-").map((id) => MAP.hexes[id]?.country);
      if (a === "ussr" && b && b !== a) found.add(b);
      if (b === "ussr" && a && a !== b) found.add(a);
    }
    found.delete("baltic-states");
    found.add("eastern-europe");
    expect([...found].sort()).toEqual([...MC21_USSR_BORDER_MINORS].sort());
  });
});
