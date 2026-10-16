import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { attackNumbers } from "../src/engine/attack-rules";
import { refreshFortresses } from "../src/engine/fortress";
import { adjacentHexes } from "../src/engine/zoc";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Fortress status, Ref 4.8: Malta and Gibraltar always; the others lose it for good when an enemy occupies them; Maginot-Line hexes not in
// the 1942 and 1944 scenarios and gone on the fall of France; West Wall hexes from 1944 if Axis-controlled then; Sevastopol while the U.S.S.R. holds it.
// P24, P25, Q24: Maginot Line (France); M27, N26, O26, P26: West Wall (Germany); D44: a standard Fortress (U.S.S.R.); V38 Sevastopol; AA7, GG19 Malta and Gibraltar.

const forts = (s: GameState): string[] => Object.entries(refreshFortresses(CTX, s).fortresses).filter(([, v]) => v).map(([k]) => k).sort();

describe("which hexes are Fortresses (Ref 4.8)", () => {
  it("1939: Malta, Gibraltar, the Maginot Line, the standard Fortress and Sevastopol; the West Wall is not one yet", () => {
    expect(forts(board([]))).toEqual(["AA7", "D44", "GG19", "P24", "P25", "Q24", "V38"]);
  });

  it("a Fortress taken by an enemy loses the status for good, even if its owner takes it back", () => {
    const base = board([]);
    const taken = refreshFortresses(CTX, { ...base, control: { P24: "germany", D44: "germany" } });
    expect(taken.fortresses.P24).toBe(false);
    expect(taken.fortresses.D44).toBe(false);
    expect(taken.fortresses.Q24).toBe(true);
    const back = refreshFortresses(CTX, { ...taken, control: {} });
    expect(back.fortresses.P24).toBe(false);
    expect(back.fortresses.D44).toBe(false);
  });

  it("Malta and Gibraltar stay Fortresses whoever stands in them", () => {
    const s = refreshFortresses(CTX, { ...board([]), control: { AA7: "germany", GG19: "germany" } });
    expect(s.fortresses.AA7).toBe(true);
    expect(s.fortresses.GG19).toBe(true);
  });

  it("the Maginot Line goes on the fall of France", () => {
    const base = board([]);
    for (const status of ["vichy", "out"] as const) {
      const s = refreshFortresses(CTX, { ...base, nations: { ...base.nations, france: { ...base.nations.france, status } } });
      expect([s.fortresses.P24, s.fortresses.P25, s.fortresses.Q24], status).toEqual([false, false, false]);
      expect(s.fortresses.D44).toBe(true); // other Fortresses are untouched
    }
  });

  it("the Maginot Line is not a Fortress in the 1942 and 1944 scenarios", () => {
    for (const sc of [SCENARIO_1942, SCENARIO_1944]) {
      const ctx = ctxFor(sc);
      const s = refreshFortresses(ctx, board([], sc));
      expect([s.fortresses.P24, s.fortresses.P25, s.fortresses.Q24], sc.id).toEqual([false, false, false]);
    }
  });

  it("the West Wall becomes a Fortress at the start of 1944 where the Axis holds it, and only there", () => {
    const base = board([]);
    const before = refreshFortresses(CTX, { ...base, year: 1943 });
    expect(before.fortresses.M27).toBeUndefined();
    const held = refreshFortresses(CTX, { ...base, year: 1944 });
    expect(["M27", "N26", "O26", "P26"].map((h) => held.fortresses[h])).toEqual([true, true, true, true]);
    const lost = refreshFortresses(CTX, { ...base, year: 1944, control: { M27: "britain" } });
    expect(lost.fortresses.M27).toBe(false);
    const retaken = refreshFortresses(CTX, { ...lost, control: {} });
    expect(retaken.fortresses.M27).toBe(false); // never again
    const later = refreshFortresses(CTX, { ...held, control: { N26: "britain" } });
    expect(later.fortresses.N26).toBe(false);
    expect(later.fortresses.M27).toBe(true);
  });

  it("Sevastopol is a Fortress while the U.S.S.R. holds it (TODO(verify): the supply conditions of 4.8 are not built)", () => {
    expect(forts(board([]))).toContain("V38");
    const lost = refreshFortresses(CTX, { ...board([]), control: { V38: "germany" } });
    expect(lost.fortresses.V38).toBeUndefined();
    const back = refreshFortresses(CTX, { ...lost, control: {} });
    expect(back.fortresses.V38).toBe(true);
  });

  it("returns the same object when nothing changes", () => {
    const once = refreshFortresses(CTX, board([]));
    expect(refreshFortresses(CTX, once)).toBe(once);
  });
});

describe("what a Fortress does in play", () => {
  it("the defender is quadrupled in a Fortress hex, from the first Player Turn on (Ref 4.8)", () => {
    const home = adjacentHexes(CTX, "P24").find((h) => CTX.map.hexes[h]?.land)!;
    const attacker = counter("g1", "germany", "infantry", 6, home, 4);
    const defender = counter("f1", "france", "infantry", 2, "P24", 3);
    const s = board([attacker, defender], undefined, { activeSide: "axis" });
    const plain = attackNumbers(CTX, s, [attacker], [defender], "P24");
    const withStatus = attackNumbers(CTX, refreshFortresses(CTX, s), [attacker], [defender], "P24");
    expect(withStatus.multiplier).toBe(4);
    expect(plain.multiplier).toBeLessThan(4);
  });
});
