import { describe, expect, it } from "vitest";
import { newGame } from "../src/engine/game";
import type { GameState } from "../src/engine/types";
import { runYearStartSequence } from "../src/engine/yearstart";
import { CTX } from "./helpers";

/** Spec 15 R13 (ticket 15-9b): the Year Start Sequence pays territory income and logs it as COUNTRY_INCOME. */
const base = (): GameState => ({ ...newGame(CTX.scenario, 1), year: 1941, units: {}, control: { M25: "germany" }, countries: {}, wars: [["germany", "ussr"]],
  conquests: [{ country: "belgium", by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "summer" } }] });
const germany = (s: GameState) => ({ ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal: 0 } } });

describe("territory income at the Year Start Sequence (spec 15 R13)", () => {
  const s = germany(base());
  const r = runYearStartSequence(CTX, s);
  const income = r.events.find((e) => e.type === "COUNTRY_INCOME" && e.nation === "germany");
  it("adds a conquered minor's value to the total and names it in the reason", () => {
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpBase + 15);
    const changed = r.events.find((e) => e.type === "BRPS_CHANGED" && e.nation === "germany");
    expect(changed?.type === "BRPS_CHANGED" && changed.reason).toMatch(/belgium: 15/);
  });
  it("logs one COUNTRY_INCOME line per country, before the total changes", () => {
    expect(income).toMatchObject({ total: 15, lines: [{ name: "belgium", value: 15, reason: "conquered" }] });
    expect(r.events.indexOf(income!)).toBeLessThan(r.events.findIndex((e) => e.type === "BRPS_CHANGED" && e.nation === "germany"));
  });
  it("lists spec 14's Moscow and Leningrad line beside it", () => {
    const moscowHex = Object.entries(CTX.map.hexes).find(([, h]) => h.name === "Moscow")?.[0];
    const withMoscow = runYearStartSequence(CTX, { ...germany(base()), control: { M25: "germany", [moscowHex!]: "germany" } });
    const e = withMoscow.events.find((x) => x.type === "COUNTRY_INCOME" && x.nation === "germany");
    expect(e?.type === "COUNTRY_INCOME" && e.lines.map((l) => l.name)).toEqual(["belgium", "Moscow and Leningrad"]);
  });
});
