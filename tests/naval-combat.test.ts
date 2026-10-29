import { describe, expect, it } from "vitest";
import { NAVAL_COMBAT_RULES, resolveNavalCombat, type NavalForce } from "../src/engine/naval-combat";
import { rollD6 } from "../src/engine/rng";
import type { NavalNation } from "../src/engine/tables";

const force = (factors = 9, nationalities: readonly NavalNation[] = ["france"], mayBreakOff = true): NavalForce => ({ factors, nationalities, mayBreakOff });
const dice = (interceptor: number, intercepted: number) => ({ interceptor, intercepted });

describe("spec 12 R12 naval combat (Ref 21.51)", () => {
  it("R12 higher modified roll wins in either direction; winner loses half rounded down", () => {
    const a = force();
    expect(resolveNavalCombat(a, a, dice(6, 1))).toMatchObject({ winner: "interceptor", breakOff: false, interceptor: { loss: 2 }, intercepted: { loss: 5 } });
    expect(resolveNavalCombat(a, a, dice(1, 6))).toMatchObject({ winner: "intercepted", interceptor: { loss: 5 }, intercepted: { loss: 2 } });
  });

  it("R12 ties in modified rolls go to the interceptor, with no losses", () => {
    const result = resolveNavalCombat(force(9, ["germany"]), force(9, ["britain"]), dice(3, 4));
    expect(result).toMatchObject({ winner: "interceptor", interceptor: { modifiedRoll: 5, loss: 0 }, intercepted: { modifiedRoll: 5, loss: 0 } });
  });

  // Spec 12 R12.1, Ref 21.51: all nations, not just the major-power fleets.
  it.each<[NavalNation, number]>([
    ["germany", 2], ["britain", 1], ["usa", 1], ["sweden", 1],
    ["france", 0], ["vichy-france", 0], ["free-france", 0], ["italy", -1],
    ["ussr", -2], ["turkey", -2], ["spain", -2],
  ])("R12.1 %s nationality DRM is %i on either side", (nation, drm) => {
    for (const [a, b, own] of [[force(9, [nation]), force(), "interceptor"], [force(), force(9, [nation]), "intercepted"]] as const) {
      expect(resolveNavalCombat(a, b, dice(3, 3))[own]).toMatchObject({ nationalityDrm: drm, advantageDrm: 0, modifiedRoll: 3 + drm });
    }
  });

  it("R12.1 mixed forces use their lowest DRM, regardless of order", () => {
    for (const nations of [["germany", "britain", "ussr"], ["ussr", "britain", "germany"]] as const) {
      const mixed = force(9, nations);
      const result = resolveNavalCombat(mixed, mixed, dice(4, 4));
      expect(result.interceptor).toMatchObject({ nationalityDrm: -2, modifiedRoll: 2 });
      expect(result.intercepted.nationalityDrm).toBe(-2);
    }
  });

  it("R12.1 Italy is -2 north of row N, -1 in or south of N (N28)", () => {
    const italy = force(9, ["italy"]);
    for (const north of [true, false]) {
      const result = resolveNavalCombat(italy, italy, dice(4, 4), { battleNorthOfRowN: north });
      expect(result.interceptor.nationalityDrm).toBe(north ? -2 : -1);
      expect(result.intercepted.nationalityDrm).toBe(north ? -2 : -1);
    }
    // The row also changes the lowest DRM of a mixed force.
    expect(resolveNavalCombat(force(9, ["italy", "france"]), force(), dice(4, 4), { battleNorthOfRowN: true }).interceptor.modifiedRoll).toBe(2);
  });

  it.each([[11, 0], [12, 1], [16, 2], [18, 3], [27, 4], [36, 5]])("R12.1 %i vs 9 gets advantage %i, smaller side gets zero", (larger, drm) => {
    const result = resolveNavalCombat(force(larger), force(), dice(3, 3));
    expect(result.interceptor).toMatchObject({ advantageDrm: drm, modifiedRoll: 3 + drm });
    expect(result.intercepted).toMatchObject({ advantageDrm: 0, modifiedRoll: 3 });
    const reversed = resolveNavalCombat(force(), force(larger), dice(3, 3));
    expect(reversed.interceptor.advantageDrm).toBe(0);
    expect(reversed.intercepted.advantageDrm).toBe(drm);
  });

  it.each([[17, 5], [18, 10], [27, 15]])("R12.2 loser with %i factors loses %i (18-factor boundary, N27)", (factors, loss) => {
    const result = resolveNavalCombat(force(factors), force(factors), dice(1, 6));
    expect(result.interceptor.loss).toBe(loss);
    expect(result.intercepted.loss).toBe(Math.floor(loss / 2));
  });

  it("R12.2 N27 rounds the multiplied loss, retaining partial fleets in factors / 9", () => {
    const a = force(23);
    // Difference 5: 5 * 23 / 9 = 12.777..., not 5 * floor(23 / 9) = 10.
    expect(NAVAL_COMBAT_RULES.multipliedLossRounding).toBe("floor");
    expect(resolveNavalCombat(a, a, dice(1, 6))).toMatchObject({ interceptor: { loss: 12 }, intercepted: { loss: 6 } });
    expect(resolveNavalCombat(a, a, dice(1, 6), { rules: { multipliedLossRounding: "ceil" } })).toMatchObject({ interceptor: { loss: 13 }, intercepted: { loss: 6 } });
  });

  it("R12.2 caps loser loss at its factors before computing winner loss", () => {
    const result = resolveNavalCombat(force(3, ["ussr"]), force(9, ["germany"]), dice(1, 6));
    expect(result).toMatchObject({ interceptor: { modifiedRoll: -1, loss: 3 }, intercepted: { modifiedRoll: 12, loss: 1 } });
  });

  it("R12.3 mayBreakOff grants permission; it does not choose break-off", () => {
    expect(resolveNavalCombat(force(), force(), dice(6, 1))).toMatchObject({ winner: "interceptor", breakOff: false });
    expect(() => resolveNavalCombat(force(9, ["france"], false), force(), dice(1, 6), { breakOff: true })).toThrow(RangeError);
    expect(resolveNavalCombat(force(9, ["france"], false), force(), dice(1, 6)).breakOff).toBe(false);
  });

  it("R12.3 break-off halves odd loss, then the winner loses half the reduced loss", () => {
    const result = resolveNavalCombat(force(), force(9, ["germany"]), dice(1, 6), { breakOff: true });
    // Difference 7 -> breaker loses 3 -> winner loses 1.
    expect(result).toMatchObject({ winner: "intercepted", breakOff: true, interceptor: { loss: 3 }, intercepted: { loss: 1 } });
  });

  it("R12.3 break-off applies the 18-factor multiplier before halving", () => {
    expect(resolveNavalCombat(force(18), force(18), dice(1, 6), { breakOff: true })).toMatchObject({ interceptor: { loss: 5 }, intercepted: { loss: 2 } });
  });

  it("R12.3 break-off caps loss at half the breaker's strength rounded down", () => {
    // Difference 14, halved to 7, capped at floor(9 / 2) = 4.
    expect(resolveNavalCombat(force(9, ["ussr"]), force(36, ["germany"]), dice(1, 6), { breakOff: true })).toMatchObject({ interceptor: { loss: 4 }, intercepted: { loss: 2 } });
    expect(resolveNavalCombat(force(1, ["ussr"]), force(9, ["germany"]), dice(1, 6), { breakOff: true }).interceptor.loss).toBe(0);
  });

  it("R12.3 breaker with a higher modified roll still loses automatically, but nobody loses factors", () => {
    // Raw dice tie; the breaker's German DRM wins the modified roll.
    expect(resolveNavalCombat(force(9, ["germany"]), force(), dice(3, 3), { breakOff: true })).toMatchObject({ winner: "intercepted", breakOff: true, interceptor: { loss: 0 }, intercepted: { loss: 0 } });
  });

  it("R12.3 a tied break-off also automatically loses, with zero losses", () => {
    expect(resolveNavalCombat(force(), force(), dice(3, 3), { breakOff: true })).toMatchObject({ winner: "intercepted", breakOff: true, interceptor: { loss: 0 }, intercepted: { loss: 0 } });
  });

  it("rejects invalid factors, missing nationalities and empty battles", () => {
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      expect(() => resolveNavalCombat(force(bad), force(), dice(1, 1))).toThrow(RangeError);
      expect(() => resolveNavalCombat(force(), force(bad), dice(1, 1))).toThrow(RangeError);
    }
    expect(() => resolveNavalCombat(force(1, []), force(), dice(1, 1))).toThrow(RangeError);
    expect(() => resolveNavalCombat(force(), force(1, []), dice(1, 1))).toThrow(RangeError);
    expect(() => resolveNavalCombat(force(0, []), force(0, []), dice(1, 1))).toThrow(RangeError);
  });

  it("accepts a zero-factor force and cannot charge it loser losses (R12.2)", () => {
    expect(resolveNavalCombat(force(0, []), force(), dice(1, 6)).interceptor.loss).toBe(0);
    expect(resolveNavalCombat(force(), force(0, []), dice(6, 1)).intercepted.loss).toBe(0);
  });

  it("rejects dice outside 1-6 and non-integers on either side", () => {
    for (const bad of [0, 7, -1, 2.5, NaN, Infinity]) {
      expect(() => resolveNavalCombat(force(), force(), dice(bad, 3))).toThrow(RangeError);
      expect(() => resolveNavalCombat(force(), force(), dice(3, bad))).toThrow(RangeError);
    }
  });

  it("is deterministic and leaves frozen force, dice and option inputs unchanged", () => {
    const a = Object.freeze({ ...force(23), nationalities: Object.freeze(["germany", "italy"] as const) });
    const b = Object.freeze(force(23));
    const d = Object.freeze(dice(1, 6));
    const options = Object.freeze({ battleNorthOfRowN: true, rules: Object.freeze({ ...NAVAL_COMBAT_RULES }) });
    expect(resolveNavalCombat(a, b, d, options)).toEqual(resolveNavalCombat(a, b, d, options));
  });

  it("R12 seeded 20,000 German/British battles agree with the exact 36-pair expectation within 0.05 factors per side", () => {
    const german = force(9, ["germany"]);
    const british = force(9, ["britain"]);
    const exact = [0, 0];
    for (let g = 1; g <= 6; g++) {
      for (let b = 1; b <= 6; b++) {
        // Independent Ref 21.51 oracle for 9 vs 9: Germany +2, Britain +1, no advantage/multiplier.
        const difference = g + 2 - (b + 1);
        exact[0]! += difference >= 0 ? Math.floor(difference / 2) : -difference;
        exact[1]! += difference >= 0 ? difference : Math.floor(-difference / 2);
        const result = resolveNavalCombat(german, british, dice(g, b));
        expect([result.interceptor.loss, result.intercepted.loss]).toEqual([
          difference >= 0 ? Math.floor(difference / 2) : -difference,
          difference >= 0 ? difference : Math.floor(-difference / 2),
        ]);
      }
    }
    let seed = 132;
    const totals = [0, 0];
    for (let battle = 0; battle < 20_000; battle++) {
      const g = rollD6(seed);
      const b = rollD6(g.state);
      seed = b.state;
      const result = resolveNavalCombat(german, british, dice(g.roll, b.roll));
      totals[0]! += result.interceptor.loss;
      totals[1]! += result.intercepted.loss;
    }
    // Stated tolerance is on each side's sampled mean, not on a sum that could hide offsetting errors.
    for (let side = 0; side < 2; side++) expect(Math.abs(totals[side]! / 20_000 - exact[side]! / 36)).toBeLessThan(0.05);
  });
});
