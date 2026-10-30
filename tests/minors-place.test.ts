import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { MINOR_COUNTRIES, DEFENSELESS_MINORS } from "../src/engine/minors-ids";
import { applyMinorPlacement, legalMinorPlacements, suggestMinorPlacement } from "../src/engine/minors-place";
import type { MinorPlacement } from "../src/engine/minors-place";
import type { MinorCountry, GameState } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

const start = (country: MinorCountry = "belgium", side: "axis" | "allies" = "allies"): GameState => ({
  ...atStart(SCENARIO_1939, 1), countries: { [country]: { status: "attacked", attacker: "germany", toPlace: side,
    duty: { by: "germany", declared: { year: 1939, season: "fall" } } } },
});
const suggestion = (s = start(), c: MinorCountry = "belgium") => suggestMinorPlacement(CTX, s, c)!;
const apply = (p: MinorPlacement[], s = start(), c: MinorCountry = "belgium") => applyMinorPlacement(CTX, s, c, p);

describe("spec 15 R3 minor placement", () => {
  it("R3: suggests deterministic legal armies for every armed chart minor, for either placing side", () => {
    for (const c of MINOR_COUNTRIES.filter((c) => !DEFENSELESS_MINORS.includes(c))) {
      for (const side of ["axis", "allies"] as const) {
        const s = start(c, side);
        const p = suggestion(s, c);
        expect(p).not.toBeNull();
        expect(suggestion(s, c)).toEqual(p);
        expect(apply(p, s, c).ok).toBe(true);
      }
    }
  });
  it("R3: uses capital first then ascending hex id", () => {
    const p = suggestion();
    const capital = Object.values(CTX.map.hexes).find((h) => h.country === "belgium" && h.features.includes("capital"))!;
    expect(p[0].at).toBe(capital.id);
    expect(p[1].at).toBe(capital.id);
    const other = legalMinorPlacements(CTX, start(), "belgium")[0].hexes.filter((h) => h !== capital.id);
    if (p.length > 2) expect(p[2].at).toBe(other[0]);
  });
  it("R3: direct chart count accepts Denmark's single infantry counter", () => {
    const s = start("denmark");
    const at = Object.values(CTX.map.hexes).find((h) => h.country === "denmark" && h.features.includes("capital-port"))!.id;
    expect(apply([{ type: "infantry", strength: 1, at }], s, "denmark").ok).toBe(true);
  });
  it("R3: requires exactly the chart counters, including type and strength", () => {
    const p = suggestion();
    for (const bad of [p.slice(1), [...p, p[0]], p.map((x, i) => i ? x : { ...x, strength: 99 }),
      p.map((x, i) => i ? x : { ...x, type: "fleet" as const })]) expect(apply(bad).ok).toBe(false);
  });
  it("R3: refuses foreign hexes and a missing ground garrison", () => {
    const s = start("denmark");
    const p = suggestion(s, "denmark");
    expect(apply(p.map((x) => ({ ...x, at: "A1" })), s, "denmark").ok).toBe(false);
    const belgium = suggestion();
    const away = legalMinorPlacements(CTX, start(), "belgium")[0].hexes.filter((h) => h !== belgium[0].at);
    let index = 0;
    const noGarrison = belgium.map((p) => p.type === "infantry" ? { ...p, at: away[Math.floor(index++ / 2)] } : p);
    const result = apply(noGarrison);
    expect(result).toEqual({ ok: false, error: "A ground unit must occupy the capital." });
  });
  it("R3/MC1: counts existing and jointly placed ground units against stacking", () => {
    const p = suggestion();
    expect(apply(p.map((x) => ({ ...x, at: p[0].at }))).ok).toBe(false);
    const s = start();
    s.units = { a: { id: "a", owner: "britain", type: "infantry", strength: 1, at: p[0].at },
      b: { id: "b", owner: "britain", type: "infantry", strength: 1, at: p[0].at } };
    expect(legalMinorPlacements(CTX, s, "belgium")[0].hexes).not.toContain(p[0].at);
    expect(apply(p, s).ok).toBe(false);
  });
  it("R3/MC1: air requires a base and capacity; fleets require a port and capacity", () => {
    const s = start("sweden");
    const choices = legalMinorPlacements(CTX, s, "sweden");
    for (const type of ["air", "fleet"] as const) {
      const row = choices.find((e) => e.type === type)!;
      expect(row.hexes.length).toBeGreaterThan(0);
      const at = row.hexes[0];
      const full = { ...s, units: { full: { id: "full", owner: "sweden" as const, type, strength: 36, at } } };
      expect(legalMinorPlacements(CTX, full, "sweden").find((e) => e.type === type)!.hexes).not.toContain(at);
      const inland = Object.values(CTX.map.hexes).find((h) => h.country === "sweden" && h.land && !h.features.length)!;
      expect(row.hexes).not.toContain(inland.id);
      const p = suggestion(s, "sweden").map((p) => p.type === type ? { ...p, at: inland.id } : p);
      expect(apply(p, s, "sweden").ok).toBe(false);
    }
  });
  it("R3/C1: applies immutably, assigns chart movement and unique ids, preserves duty, clears pending flag", () => {
    const s = start();
    const before = structuredClone(s);
    const p = suggestion(s);
    const r = apply(p, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s).toEqual(before);
    expect(r.state.nextUnitId).toBe(s.nextUnitId + p.length);
    expect(Object.values(r.state.units)).toEqual(p.map((p, i) => ({ ...p, owner: "belgium", movement: p.type === "air" ? 4 : 3, id: `u${s.nextUnitId + i}` })));
    expect(r.state.countries?.belgium).toEqual({ status: "attacked", attacker: "germany", duty: s.countries?.belgium?.duty });
    expect(apply(p, r.state).ok).toBe(false);
  });
  it("R3/C1: rejects absent, neutral, conquered and already placed records; defenseless armies are skipped", () => {
    const s = start();
    for (const bad of [{ ...s, countries: undefined }, { ...s, countries: { belgium: { status: "neutral" as const, toPlace: "allies" as const } } },
      { ...s, conquests: [{ country: "belgium" as const, by: "germany" as const, side: "axis" as const, how: "capital" as const, at: { year: 1939, season: "fall" as const } }] }]) {
      expect(legalMinorPlacements(CTX, bad, "belgium")).toEqual([]);
      expect(suggestMinorPlacement(CTX, bad, "belgium")).toBeNull();
      expect(apply(suggestion(), bad).ok).toBe(false);
    }
    expect(suggestMinorPlacement(CTX, start("persia"), "persia")).toBeNull();
    const full = start("denmark");
    full.units = Object.fromEntries(legalMinorPlacements(CTX, full, "denmark")[0].hexes.flatMap((at) => [0, 1].map((i) => [`${at}-${i}`, { id: `${at}-${i}`, owner: "denmark" as const, type: "infantry" as const, strength: 1, at }])));
    expect(suggestMinorPlacement(CTX, full, "denmark")).toBeNull();
  });
});
