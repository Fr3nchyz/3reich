import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { conquestIncome, conquestRecipient } from "../src/engine/conquest-income";
import { fall } from "../src/engine/conquest";
import { advance } from "../src/engine/turn";
import { runYearStartSequence } from "../src/engine/yearstart";
import type { ForceOwner, GameState, Scenario } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 14 ticket 14-5, R4 (Ref 9.2, 18.1): in every Year Start Sequence the conqueror gets half, rounded down, of what the conquered Power began the
// scenario with, while it still holds the capital. TODO(verify) V9 (the printed total, not the Base), V31 (who receives, "still holds").

const BERLIN = "L31";
const STEP_7P = { part: "player-turn", turn: 1, step: "7p" } as const;

/** Germany has fallen to `by` in Spring 1940, Berlin held by `by` (the state a Year Start Sequence of 1941 starts from). */
function fallen(by: ForceOwner = "britain", scenario: Scenario = SCENARIO_1939): GameState {
  const ctx = ctxFor(scenario);
  const s = board([counter("b1", by, "infantry", 3, BERLIN, 3)], scenario, { year: 1940, season: "spring", firstSide: "axis", activeSide: "axis", position: STEP_7P, control: { [BERLIN]: by } });
  return { ...fall(ctx, s, "germany", by).state, year: 1941, season: "spring" };
}

describe("the half-BRPs of a conquered Major Power", () => {
  it("the conqueror's total in the next Year Start Sequence is its grown Base plus half of 150: 75", () => {
    const s = fallen();
    const r = runYearStartSequence(CTX, s);
    const before = runYearStartSequence(CTX, { ...s, conquests: [] }); // the same year without the conquest
    expect(r.state.nations.britain.brpTotal - before.state.nations.britain.brpTotal).toBe(75);
    expect(r.state.nations.britain.spendLimit).toBe(Math.floor(r.state.nations.britain.brpTotal / 2));
    expect(r.events.some((e) => e.type === "BRPS_CHANGED" && e.nation === "britain" && /75 from conquered countries/.test(e.reason))).toBe(true);
  });
  it("rounded down: a Power that began with 151 pays 75, one that began with 150 pays 75, 153 pays 76", () => {
    const odd = (n: number): Scenario => ({ ...SCENARIO_1939, nations: { ...SCENARIO_1939.nations, germany: { ...SCENARIO_1939.nations.germany, brpTotal: n } } });
    for (const [n, half] of [[151, 75], [150, 75], [153, 76], [1, 0]] as const) {
      const sc = odd(n);
      expect(conquestIncome(ctxFor(sc), fallen("britain", sc), "britain"), String(n)).toBe(half);
    }
  });
  it("the printed total, not the Base: a Minor-Ally's BRPs are in it (Germany's 1944 total is Base plus 45)", () => {
    // 1939 has no Minor-Allies, so make the total differ from the Base by hand
    const sc: Scenario = { ...SCENARIO_1939, nations: { ...SCENARIO_1939.nations, germany: { ...SCENARIO_1939.nations.germany, brpBase: 150, brpTotal: 195 } } };
    expect(conquestIncome(ctxFor(sc), fallen("britain", sc), "britain")).toBe(97);
  });
  it("only the conqueror gets it: Germany stays at 0 and is skipped, France gets nothing", () => {
    const r = runYearStartSequence(CTX, fallen()).state;
    expect(r.nations.germany.brpTotal).toBe(0);
    expect(r.nations.germany.spendLimit).toBe(0);
    expect(conquestIncome(CTX, fallen(), "france")).toBe(0);
  });
  it("only while the conqueror's side still holds the capital", () => {
    const s = fallen();
    expect(conquestIncome(CTX, s, "britain")).toBe(75);
    expect(conquestIncome(CTX, { ...s, control: { ...s.control, [BERLIN]: "italy" } }, "britain")).toBe(0);
    expect(conquestIncome(CTX, { ...s, control: { ...s.control, [BERLIN]: "france" } }, "britain")).toBe(75); // held by the other Ally: still the Allies'
  });
  it("two conquests pay twice: Germany to Britain and Italy to Britain (their starting totals halved)", () => {
    const s = fallen();
    const both = { ...s, conquests: [...s.conquests!, { country: "italy" as const, by: "britain" as const, side: "axis" as const, how: "capital" as const, at: { year: 1940, season: "summer" as const }, startingBrps: 75 }], control: { ...s.control, Y22: "britain" as const } };
    expect(conquestIncome(CTX, both, "britain")).toBe(75 + 37);
  });
  it("the recipient when the unit in the capital is not a Major Power's: a Minor-Ally's protector, Britain for the Free French and Poland, Germany for Vichy France", () => {
    const s = board([]);
    const withAlly = { ...s, minorAllies: [{ owner: "finland" as const, of: "germany" as const, active: true }] };
    expect(conquestRecipient(withAlly, "finland")).toBe("germany");
    expect(conquestRecipient(s, "free-france")).toBe("britain");
    expect(conquestRecipient(s, "poland")).toBe("britain");
    expect(conquestRecipient(s, "vichy-france")).toBe("germany");
    expect(conquestRecipient(s, "ussr")).toBe("ussr");
  });
});

describe("the date: a capital lost in the second half of a Winter turn pays one sequence later", () => {
  it("the Year Start Sequence that follows that Winter turn has no conquest yet (the owner's Combat Phase is in Spring); the next one pays", () => {
    // Winter 1940, second Player Turn (the Allies) over: Berlin is British. The Axis turn that could take it back is in Spring.
    const s = board([counter("b1", "britain", "infantry", 3, BERLIN, 3)], SCENARIO_1939, { year: 1940, season: "winter", firstSide: "axis", activeSide: "allies", position: { part: "player-turn", turn: 2, step: "10b" }, control: { [BERLIN]: "britain" } });
    const turnOver = advance(CTX, s).state;
    expect(turnOver.position).toEqual({ part: "year-start" });
    expect(turnOver.conquests).toBeUndefined();
    const yss = advance(CTX, turnOver).state;
    expect(yss.nations.britain.brpTotal).toBe(runYearStartSequence(CTX, { ...turnOver, conquests: [] }).state.nations.britain.brpTotal); // nothing yet
    // Spring 1941, the Axis turn: Germany falls at the end of its Combat Phase
    const spring = { ...yss, position: STEP_7P, activeSide: "axis" as const };
    const fell = advance(CTX, spring).state;
    expect(fell.conquests![0]).toMatchObject({ country: "germany", at: { year: 1941, season: "spring" } });
    const later = { ...fell, year: 1942, season: "spring" as const };
    expect(runYearStartSequence(CTX, later).state.nations.britain.brpTotal - runYearStartSequence(CTX, { ...later, conquests: [] }).state.nations.britain.brpTotal).toBe(75);
  });
  it("a capital lost in the first Player Turn of a Winter turn falls in that Winter turn, so the sequence right after it pays", () => {
    const s = board([counter("b1", "britain", "infantry", 3, BERLIN, 3)], SCENARIO_1939, { year: 1940, season: "winter", firstSide: "allies", activeSide: "axis", position: { part: "player-turn", turn: 2, step: "7p" }, control: { [BERLIN]: "britain" } });
    const fell = advance(CTX, s).state;
    expect(fell.conquests![0]!.at).toEqual({ year: 1940, season: "winter" });
    const next = runYearStartSequence(CTX, { ...fell, year: 1941, season: "spring" }).state;
    expect(next.nations.britain.brpTotal - runYearStartSequence(CTX, { ...fell, year: 1941, season: "spring", conquests: [] }).state.nations.britain.brpTotal).toBe(75);
  });
});
