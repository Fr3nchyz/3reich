import { describe, expect, it } from "vitest";
import { attritionHexTap, attritionModel, attritionResults } from "../src/ui/attritionView";
import { ATTRITION_TABLE } from "../src/engine/combat";
import { neighborIds } from "../src/engine/attack-rules";
import { turnKey } from "../src/engine/combat-record";
import type { AttritionRun } from "../src/engine/attrition-record";
import { board, counter } from "./board";
import { CTX } from "./helpers";

const base = () => board([
  counter("g", "germany", "infantry", 15, "M32"),
  counter("g2", "germany", "armor", 4, "L33"),
  counter("f", "france", "infantry", 2, "M33"),
  counter("r", "france", "replacement", 1, "M34"),
], undefined, { activeSide: "axis", control: { M33: "france", M34: "france" },
  frontOptions: { eastern: { option: "attrition" } }, position: { part: "player-turn", turn: 1, step: "7a" } });
function running(stage: AttritionRun["stage"], extra: Partial<AttritionRun> = {}) {
  const s = base();
  s.attrition = { turn: turnKey(s), done: ["eastern"], used: ["g"], run: {
    front: "eastern", factors: 15, column: "11-20", roll: 1, mustLose: 1, hexesLeft: 1,
    participants: ["g", "g2"], against: ["france"], stage,
    chooser: stage === "losses" || stage === "retreat" ? "allies" : "axis", taken: [], ...extra,
  } };
  return s;
}

describe("pure Attrition cards (spec 16 D2)", () => {
  it("R3: reads all six results from the table and has no zero-factor column", () => {
    expect(attritionResults(23).map((r) => [r.units, r.hexes])).toEqual(ATTRITION_TABLE["21-30"]);
    expect(attritionResults(23).map((r) => r.roll)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(attritionResults(0)).toEqual([]);
  });
  it("R2/R8: counts chips, supports leaving all out, and supplies timing buttons", () => {
    const s = base();
    const m = attritionModel(CTX, s, "axis")!;
    expect(m.fronts[0]).toMatchObject({ factors: 19, count: 2, column: "11-20" });
    expect(m.fronts[0]!.chips.every((c) => c.note === "Counts")).toBe(true);
    expect(m.fronts[0]!.confirm.action?.type).toBe("RESOLVE_ATTRITION");
    expect(m.moveOn.text).toBe("After the battles");
    const empty = attritionModel(CTX, s, "axis", { front: "eastern", units: [] })!.fronts[0]!;
    expect(empty).toMatchObject({ factors: 0, results: [], confirm: { disabled: true } });
    expect(empty.chips.every((c) => c.note === "Left out")).toBe(true);
    s.position = { part: "player-turn", turn: 1, step: "7p" };
    expect(attritionModel(CTX, s, "axis")!.moveOn.text).toBe("Skip");
    expect(attritionModel(CTX, s, "axis")!.fronts[0]!.heading).toContain("earlier");
  });
  it("R4/Q4: offers replacements first, validates manual losses, and caps the count", () => {
    const s = running("losses");
    const m = attritionModel(CTX, s, "allies")!;
    expect(m.chips.find((c) => c.id === "r")).toMatchObject({ chosen: true, factors: 1, from: expect.any(String), name: expect.stringContaining("replacement") });
    expect(m.chooseForMe.action).toMatchObject({ units: ["r"] });
    expect(attritionModel(CTX, s, "allies", { units: ["f"] })!.confirm.disabled).toBe(false);
    expect(attritionModel(CTX, s, "allies", { units: ["f", "f"] })!.confirm.disabled).toBe(true);
    s.attrition!.run!.mustLose = 9;
    expect(attritionModel(CTX, s, "allies")!.heading).toContain("Choose 2 units");
  });
  it("R4/R8: exposes the chooser read-only to the other side and ignores stale records", () => {
    const s = running("losses");
    const m = attritionModel(CTX, s, "axis")!;
    expect(m.readOnly).toBe(true);
    expect(m.waiting).toContain("losses");
    expect(m.confirm.disabled).toBe(true);
    expect(m.chooseForMe.disabled).toBe(true);
    s.attrition!.turn = "stale";
    expect(attritionModel(CTX, s, "axis")!.stage).toBe("resolve");
    s.position = { part: "player-turn", turn: 1, step: "7h" };
    expect(attritionModel(CTX, s, "axis")).toBeNull();
  });
  it("R3/R5: result retains the rolled hex allowance after taking a hex", () => {
    const s = running("hex", { hexesLeft: 0 });
    expect(attritionModel(CTX, s, "axis")!.result).toBe("Die: 1. The Allies lose 1 unit and must give up 1 hex.");
  });
  it("R5: exposes targets, confirmation and engine fortress/wrong-Front reasons", () => {
    const s = running("hex");
    expect(attritionModel(CTX, s, "axis")!.targets).toContain("M33");
    expect(attritionHexTap(CTX, s, "M33")!.confirm.disabled).toBe(false);
    expect(attritionModel(CTX, s, "allies", { hex: "M33" })!.tapped!.confirm.disabled).toBe(true);
    s.fortresses.M33 = true;
    expect(attritionHexTap(CTX, s, "M33")!.reason).toContain("fortress");
    expect(attritionHexTap(CTX, s, "M33")!.confirm.disabled).toBe(true);
    s.attrition!.run!.front = "western";
    expect(attritionHexTap(CTX, s, "M33")!.reason).toContain("Front");
  });
  it("R6/Q4: retreat chips expose legal destinations and a legal automatic choice", () => {
    const s = running("retreat", { target: "M33", retreating: ["f"] });
    const m = attritionModel(CTX, s, "allies")!;
    expect(m.chips[0]!.destinations.length).toBeGreaterThan(0);
    expect(m.chooseForMe.action?.type).toBe("RETREAT_UNIT");
    const to = m.chips[0]!.destinations[0]!;
    expect(attritionModel(CTX, s, "allies", { unit: "f", hex: to })!.confirm.action).toMatchObject({ unit: "f", to });
    expect(m.confirm.disabled).toBe(true);
  });
  it("R6: marks a trapped chip and exposes deferred ground overstack repair", () => {
    const s = running("retreat", { target: "M33", retreating: ["f"] });
    for (const [i, hex] of neighborIds(CTX, "M33").entries()) {
      const u = counter(`block${i}`, "germany", "infantry", 1, hex);
      s.units[u.id] = u;
    }
    const trapped = attritionModel(CTX, s, "allies")!;
    expect(trapped.chips[0]).toMatchObject({ destinations: [], note: "eliminated: nowhere to go" });
    expect(trapped.chooseForMe.disabled).toBe(true);
    for (let i = 0; i < 2; i++) s.units[`extra${i}`] = counter(`extra${i}`, "france", "infantry", 1, "M33");
    expect(attritionModel(CTX, s, "allies")!.overstack).toContainEqual({ hex: "M33", units: expect.arrayContaining(["f", "extra0", "extra1"]), text: expect.stringContaining("Movement Phase") });
  });
  it("R7: selects the strongest occupier and rejects empty or duplicate choices", () => {
    const s = running("occupy", { target: "M33" });
    delete s.units.f;
    const m = attritionModel(CTX, s, "axis")!;
    expect(m.chips.find((c) => c.id === "g")!.chosen).toBe(true);
    expect(m.confirm.action).toMatchObject({ units: ["g"] });
    expect(attritionModel(CTX, s, "axis", { units: [] })!.confirm.disabled).toBe(true);
    expect(attritionModel(CTX, s, "axis", { units: ["g", "g"] })!.confirm.disabled).toBe(true);
  });
  it("R2–R8: repeated queries preserve input and RNG", () => {
    const s = running("losses");
    const before = structuredClone(s);
    expect(attritionModel(CTX, s, "allies")).toEqual(attritionModel(CTX, s, "allies"));
    expect(s).toEqual(before);
  });
});
