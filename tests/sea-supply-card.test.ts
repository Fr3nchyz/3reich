import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { navalOf, markUsed } from "../src/engine/naval-record";
import { supplyStatus } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { navalProblemText } from "../src/ui/navalText";
import { otherFleets, portCapacityLine, seaSupplyCardModel } from "../src/ui/seaSupplyCard";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 12 D1/D2/D5, F4; Ref 19.31, 21.1. Display data only; actions are checked against the engine with supply effects enabled here.
const ON = { ...CTX, supplyEffects: true };
const inf = (id: string, at = "AA19") => counter(id, "italy", "infantry", 1, at, 3);
const fleet = (id: string, at = "U22", strength = 9, owner: Unit["owner"] = "italy") => counter(id, owner, "fleet", strength, at);
function position(extra: Unit[] = [], units = [inf("raw-infantry-01"), inf("raw-infantry-02"), counter("raw-airbase-03", "italy", "airbase", 1, "AA19")]): GameState {
  const base = board([]);
  return board([...units, fleet("raw-fleet-04"), ...extra], undefined, {
    activeSide: "axis", nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } },
    position: { part: "player-turn", turn: 1, step: "6e" }, control: { AA19: "italy", Z19: "italy", X20: "italy" },
  });
}
const apply = (s: GameState, action: Action) => {
  const result = applyAction(ON, s, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};
/** Scan every display string, excluding only action payloads, whose ids are required by the engine and never rendered. */
function displayStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(displayStrings);
  if (value && typeof value === "object") return Object.entries(value).filter(([key]) => key !== "action").flatMap(([, v]) => displayStrings(v));
  return [];
}

describe("the sea-supply card's pure model (spec 12 D1/D5)", () => {
  it("names the Cagliari pocket, proposes Genoa's fleet with the D1 sentences, and saves the units", () => {
    const s = position(), model = seaSupplyCardModel(ON, s, "axis");
    expect(model.title).toBe("3 UNITS ARE CUT OFF FROM SUPPLY");
    expect(model.groups).toEqual([{ hex: "AA19", place: "Cagliari (AA19)", units: ["1-3 Italian infantry", "1-3 Italian infantry", "1 Italian airbase"], reason: "No land line to a supply source." }]);
    expect(model.proposal!.fleets).toEqual(["9 Italian fleet at Genoa (U22)"]);
    expect(model.proposal!.destination).toBe("Cagliari (AA19)");
    expect(model.proposal!.explanation).toContain("Cagliari (AA19) is joined to Cagliari (AA19) by land.");
    expect(model.proposal!.explanation).toContain("It can carry 9, needs 3.");
    expect(model.proposal!.explanation).toContain("Afterwards this fleet can do nothing else this Game Turn.");
    expect(legalActions(ON, s)).toContainEqual(model.proposal!.action);
    expect(supplyStatus(ON, apply(s, model.proposal!.action), "axis").unsupplied).toEqual([]);
    expect(model.continue.text).toBe("Leave them cut off, continue");
    expect(legalActions(ON, s)).toContainEqual(model.continue.action);
  });

  it("groups each cut-off place once, shows singular grammar, and does not change state", () => {
    const s = position([], [inf("raw-unit-1", "X20"), inf("raw-unit-2", "AA19")]), before = JSON.stringify(s);
    expect(seaSupplyCardModel(ON, s, "axis").groups.map((g) => g.place)).toEqual(["Cagliari (AA19)", "Ajaccio (X20)"]);
    expect(seaSupplyCardModel(ON, position([], [inf("raw-single")]), "axis").title).toBe("1 UNIT IS CUT OFF FROM SUPPLY");
    expect(JSON.stringify(s)).toBe(before);
  });

  it("explains other-Front, used and unconnected fleets with the engine's reasons", () => {
    const s = markUsed(position([fleet("raw-wrong-front", "K28", 9, "germany"), fleet("raw-used", "W22"), fleet("raw-cutoff", "AA19"), fleet("raw-other-side", "K21", 9, "britain")]), ["raw-used"], "mission");
    const choices = otherFleets(ON, s, "axis", "AA19");
    expect(choices).toHaveLength(4);
    const good = choices.find((c) => c.from === "Genoa (U22)")!;
    expect(good.reason).toBeNull(); expect(good.action!.type).toBe("DESIGNATE_SEA_SUPPLY");
    expect(choices.find((c) => c.from === "Wilhelmshaven (K28)")!.reason).toMatch(/Front/);
    expect(choices.find((c) => c.from === "Livorno (W22)")!.reason).toMatch(/already been used this Game Turn/);
    expect(choices.find((c) => c.from === "Cagliari (AA19)")!.reason).toMatch(/no land supply line to a supply source/);
    for (const c of choices) {
      if (c.action) expect(legalActions(ON, s)).toContainEqual(c.action);
      else expect(c.reason).toBeTruthy();
    }
  });

  it("never offers a designation or way-on action at a different step", () => {
    const s = position(), movement = { ...s, position: { part: "player-turn" as const, turn: 1 as const, step: "6f" } };
    expect(seaSupplyCardModel(ON, movement, "axis").proposal).toBeNull();
    expect(seaSupplyCardModel(ON, movement, "axis").continue.action).toBeNull();
    expect(otherFleets(ON, movement, "axis").every((f) => f.action === null)).toBe(true);
  });

  it("uses capacity remaining after earlier designations", () => {
    const units = [...Array.from({ length: 6 }, (_, i) => inf(`raw-fed-${i}`)), ...Array.from({ length: 3 }, (_, i) => inf(`raw-cut-${i}`, "X20"))];
    const s = position([], units);
    const recorded = { ...s, naval: { ...navalOf(s), supply: [{ fleets: ["raw-fleet-04"], from: "U22", to: "AA19", units: units.slice(0, 6).map((u) => u.id) }] } };
    const model = seaSupplyCardModel(ON, recorded, "axis");
    expect(model.title).toBe("3 UNITS ARE CUT OFF FROM SUPPLY");
    expect(model.proposal!.explanation).toContain("It can carry 3, needs 3.");
  });

  it("handles no cut-off units and no usable fleet with explicit empty choices", () => {
    const s = position([], [inf("raw-land", "U22")]);
    expect(seaSupplyCardModel(ON, s, "axis")).toMatchObject({ title: "0 UNITS ARE CUT OFF FROM SUPPLY", groups: [], proposal: null });
    expect(otherFleets(ON, s, "axis")[0]!.reason).toMatch(/No cut-off unit/);
    const used = markUsed(position(), ["raw-fleet-04"], "mission");
    expect(seaSupplyCardModel(ON, used, "axis").proposal).toBeNull();
    expect(otherFleets(ON, used, "axis")[0]!.reason).toMatch(/already been used/);
  });

  it("no display string contains a raw unit id, including engine refusal strings", () => {
    const s = markUsed(position([fleet("raw-used-fleet", "W22")]), ["raw-used-fleet"], "mission");
    const strings = displayStrings([seaSupplyCardModel(ON, s, "axis"), otherFleets(ON, s, "axis")]);
    expect(strings.length).toBeGreaterThan(10);
    for (const text of strings) for (const id of Object.keys(s.units)) expect(text).not.toContain(id);
    expect(navalProblemText(s, "raw-infantry-01 cannot join raw-infantry-02.")).toBe("1-3 Italian infantry cannot join 1-3 Italian infantry.");
  });
});

describe("port capacity text (spec 12 D2; Ref 21.1, 5.0)", () => {
  it("counts only naval factors and uses the engine's ordinary 36 limit", () => {
    const s = position([fleet("raw-extra-1"), fleet("raw-extra-2"), inf("raw-not-naval", "U22")]);
    expect(portCapacityLine(ON, s, "U22")).toBe("naval factors 27 of 36");
  });
  it("shows Malta's 9-factor cap and no line for a non-port", () => {
    const s = position([fleet("raw-malta", "GG19", 6, "britain")]);
    expect(portCapacityLine(ON, s, "GG19")).toBe("naval factors 6 of 9 (Malta: 9 at most)");
    expect(portCapacityLine(ON, s, "M32")).toBeNull();
  });
});
