import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions, type Action } from "../src/engine/actions";
import { capitalOf } from "../src/engine/minors-rules";
import type { GameState } from "../src/engine/types";
import { minorDeclareModel, minorDutyMarks, minorHexModel, minorPlacementModel } from "../src/ui/minorView";
import { atStart, CTX } from "./helpers";

const start = () => atStart(SCENARIO_1939, 1);
const placing = (): GameState => ({ ...start(), countries: { belgium: {
  status: "attacked", attacker: "germany", toPlace: "allies",
} }, position: { part: "player-turn", turn: 1, step: "2" } });
const panel = (s = placing(), draft?: Parameters<typeof minorPlacementModel>[4]) =>
  minorPlacementModel(CTX, s, "allies", legalActions(CTX, s), draft)!;
const belgium = (s = start(), actions = legalActions(CTX, s)) => minorDeclareModel(CTX, s, "germany", "belgium", actions);

describe("minor models (spec 15 D1/D2/D5)", () => {
  it("R1/R2 D1: chart forces, territory value, price and atomic declaration button", () => {
    const m = belgium();
    expect(m).toMatchObject({ name: "Belgium", group: "Small countries", cost: 10, value: 15, status: "neutral", reason: null });
    expect(m.summary).toBe("5 infantry factors, 1 air factor");
    expect(m.buttons[0]).toMatchObject({ text: "Declare war", disabled: false, action: { type: "DECLARE_WAR", by: "germany", on: "belgium" } });
    expect(m.buttons[1]!.text).toBe("Cancel");
  });
  it("R4 D1: declaration card explains the duty and lost payment", () => {
    expect(belgium().text).toBe("Declare war on Belgium for 10 BRPs? This turn you must move a unit into Belgium or attack it. If you cannot, the declaration is cancelled and the 10 BRPs are lost.");
  });
  it("R2 D1: legal actions gate confirmation even when country rules allow it", () => {
    expect(belgium(start(), []).buttons[0]).toMatchObject({ disabled: true, action: null });
    expect(belgium(start(), []).reason).toContain("spending limit");
    const s = start();
    s.countries = { belgium: { status: "neutral", closedTo: ["germany"] } };
    expect(belgium(s)).toMatchObject({ status: "closed to you: a German garrison", reason: "A Garrison bars this declaration." });
  });
  it("R1/R11 D1: defenseless and opened Persia explain why no army or declaration is needed", () => {
    const s = start();
    s.countries = { persia: { status: "neutral", opened: true } };
    expect(minorDeclareModel(CTX, s, "germany", "persia", [])).toMatchObject({ summary: "No army.", text: "Persia is open to the Axis: no declaration." });
  });
  it("R3 D2: only the offered placing side gets a panel", () => {
    const s = placing();
    expect(minorPlacementModel(CTX, s, "axis", legalActions(CTX, s))).toBeNull();
    expect(minorPlacementModel(CTX, s, "allies", [])).toBeNull();
    expect(minorPlacementModel(CTX, start(), "allies", legalActions(CTX, start()))).toBeNull();
  });
  it("R3/R16 D2: counter chips, home destinations, capital hint and automatic button first", () => {
    const m = panel();
    expect(m.title).toBe("Germany attacked Belgium. Place Belgium's army.");
    expect(m.hint).toContain("Brussels");
    expect(m.chips).toHaveLength(5);
    expect(m.chips.map((c) => c.type)).toEqual(["infantry", "infantry", "infantry", "infantry", "air"]);
    for (const chip of m.chips) {
      expect(chip.hexes.length).toBeGreaterThan(0);
      expect(chip.hexes.every((h) => CTX.map.hexes[h]?.country === "belgium")).toBe(true);
    }
    expect(m.buttons.map((b) => b.text)).toEqual(["Place automatically", "Done"]);
    expect(m.buttons[0]!.disabled).toBe(false);
    expect(m.buttons[1]).toMatchObject({ disabled: true, action: null });
  });
  it("R3 D2: a complete suggestion enables Done; partial, foreign and overstacked drafts do not", () => {
    const auto = panel().buttons[0]!.action!;
    expect(panel(placing(), auto.placements).buttons[1]).toMatchObject({ disabled: false, action: auto });
    expect(panel(placing(), auto.placements.slice(1)).buttons[1]!.disabled).toBe(true);
    expect(panel(placing(), auto.placements.map((p) => ({ ...p, at: "M35" }))).buttons[1]!.disabled).toBe(true);
    const cap = capitalOf(CTX, "belgium")!;
    expect(panel(placing(), auto.placements.map((p) => ({ ...p, at: cap }))).buttons[1]!.disabled).toBe(true);
  });
  it("R3/MC1 D2: editing reserves the other draft chips when computing legal destinations", () => {
    const auto = panel().buttons[0]!.action!;
    const cap = capitalOf(CTX, "belgium")!;
    const draft = auto.placements.map((p, i) => i < 2 ? { ...p, at: cap } : p);
    expect(panel(placing(), draft).chips[2]!.hexes).not.toContain(cap);
  });
  it("R3 D2: complete army still requires a ground unit in the capital", () => {
    const m = panel();
    const auto = m.buttons[0]!.action!;
    const cap = capitalOf(CTX, "belgium")!;
    const other = m.chips[0]!.hexes.find((h) => h !== cap)!;
    const draft = auto.placements.map((p) => p.at === cap && p.type === "infantry" ? { ...p, at: other } : p);
    expect(panel(placing(), draft).buttons[1]!.disabled).toBe(true);
  });
  it("R9 D5: an awakened ally uses the same panel without inventing an attacker", () => {
    const s: GameState = { ...placing(), minorAllies: [{ owner: "hungary", of: "germany", active: true }], countries: { hungary: { status: "neutral", toPlace: "axis" } } };
    expect(minorPlacementModel(CTX, s, "axis", legalActions(CTX, s))?.title).toBe("Hungary joins Germany. Place Hungary's army.");
  });
  it("R4 D1/D3: duty marks disappear when met while the war status remains", () => {
    const s = placing();
    s.countries!.belgium!.duty = { by: "germany", declared: { year: s.year, season: s.season } };
    expect(minorDutyMarks(s)).toEqual([{ minor: "belgium", tone: "red", text: "Belgium: enter or attack this turn" }]);
    const cap = capitalOf(CTX, "belgium")!;
    expect(minorHexModel(CTX, s, cap)?.lines).toEqual(["Belgium is at war with Germany."]);
    delete s.countries!.belgium!.duty;
    expect(minorDutyMarks(s)).toEqual([]);
    expect(minorHexModel(CTX, s, cap)?.lines).toHaveLength(1);
  });
  it("R9/R10 D5: sleeping land has a light tint and only its capital has a marker", () => {
    const s = start();
    const cap = capitalOf(CTX, "hungary")!;
    expect(minorHexModel(CTX, s, cap)).toMatchObject({ tint: "axis-light", marker: "asleep", lines: ["Hungary sleeps. It joins Germany in Summer 1941. German units may enter."] });
    const other = Object.values(CTX.map.hexes).find((h) => h.country === "hungary" && h.id !== cap)!;
    expect(minorHexModel(CTX, s, other.id)).toMatchObject({ tint: "axis-light", marker: null });
    s.minorAllies = s.minorAllies.map((m) => ({ ...m, active: true }));
    expect(minorHexModel(CTX, s, cap)).toMatchObject({ tint: null, marker: null, lines: [] });
  });
  it("R7/R9 D5: conquered and unknown hexes have no minor overlay; old saves are readable", () => {
    const s = start();
    expect(minorHexModel(CTX, s, "unknown")).toBeNull();
    s.conquests = [{ country: "hungary", by: "britain", side: "axis", how: "capital", at: { year: 1940, season: "spring" } }];
    expect(minorHexModel(CTX, s, capitalOf(CTX, "hungary")!)).toBeNull();
    delete s.countries;
    expect(minorDutyMarks(s)).toEqual([]);
    expect(belgium(s).status).toBe("neutral");
  });
  it("R3 D2: models are deterministic and leave state, actions and drafts unchanged", () => {
    const s = placing();
    const actions: Action[] = legalActions(CTX, s);
    const draft = panel(s).buttons[0]!.action!.placements;
    const before = JSON.stringify({ s, actions, draft });
    const first = minorPlacementModel(CTX, s, "allies", actions, draft);
    expect(minorPlacementModel(CTX, s, "allies", actions, draft)).toEqual(first);
    expect(JSON.stringify({ s, actions, draft })).toBe(before);
  });
});
