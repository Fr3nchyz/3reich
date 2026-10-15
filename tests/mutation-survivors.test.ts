import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction } from "../src/engine/actions";
import { applyBuild } from "../src/engine/construction";
import { attackerPool, crossable } from "../src/engine/attack-rules";
import { resolveOffensiveCombat } from "../src/engine/combat";
import { combatOf } from "../src/engine/combat-record";
import { applyGrant, grantRoom } from "../src/engine/grants";
import { reachableHexes } from "../src/engine/movement";
import { rollD6 } from "../src/engine/rng";
import { angloFrenchHexes } from "../src/engine/stacking";
import { applyDeclaration, declarationTargets } from "../src/engine/war";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, atStart, ctxFor } from "./helpers";

/**
 * Tests added after the mutation run in docs/MUTATION.md: each pins a rule that a deliberate edit of the
 * engine could break without any earlier test noticing. One describe per rule, with its citation.
 */

describe("a counterattack that rolls D or A ends the battle (Ref 12.1-12.2)", () => {
  // After CA, CA1, CA2 or CA3 the defender counterattacks; on that roll "D" eliminates the original attackers
  // and "A" eliminates the counterattacking defenders, and nothing else is rolled afterwards.
  const input = { attackFactors: 12, defenseBasicFactors: 3, defenseMultiplier: 2 };
  it("D on the defender's roll eliminates the attackers at once; A eliminates the defenders at once", () => {
    let sawD = 0;
    let sawA = 0;
    for (let seed = 1; seed < 3000; seed++) {
      const r = resolveOffensiveCombat(input, seed);
      const i = r.rounds.findIndex((x) => x.by === "defender" && (x.result === "D" || x.result === "A"));
      if (i < 0) continue;
      expect(i, `seed ${seed}: no round after the deciding counterattack`).toBe(r.rounds.length - 1);
      if (r.rounds[i]!.result === "D") {
        sawD++;
        expect(r.outcome).toEqual({ kind: "attacker-eliminated" });
      } else {
        sawA++;
        expect(r.outcome).toEqual({ kind: "defender-eliminated" });
      }
    }
    expect(sawD).toBeGreaterThan(0);
    expect(sawA).toBeGreaterThan(0);
  });
});

describe("what ground units may cross in an attack (Ref 4.6, 4.51)", () => {
  it("the Qattara flag alone forbids an attack across that hexside, whatever its land flag says", () => {
    const hexsides = { ...MAP.hexsides, "MM26-NN26": { ...MAP.hexsides["MM26-NN26"]!, land: true } };
    const odd = { ...CTX, map: { ...MAP, hexsides } };
    expect(odd.map.hexsides["MM26-NN26"].qattara).toBe(true);
    expect(crossable(odd, "MM26", "NN26")).toBe(false);
    expect(crossable(odd, "NN26", "MM26")).toBe(false);
    expect(crossable(CTX, "M32", "M33")).toBe(true); // ordinary land
    expect(crossable(CTX, "K24", "L24")).toBe(false); // the Channel
  });
});

describe("only Major Powers in the war attack (spec 04 and the Ref 12.1 attacker pool)", () => {
  it("a neutral Major Power's ground units are not in the pool of attackers, a Major Power at war is", () => {
    const s = { ...atStart(SCENARIO_1939, 1), activeSide: "axis" as const };
    expect(s.nations.italy.status).toBe("neutral");
    const units: Unit[] = [counter("g1", "germany", "infantry", 3, "M32", 3), counter("it1", "italy", "infantry", 3, "N32", 3)];
    const state: GameState = { ...s, units: Object.fromEntries(units.map((u) => [u.id, u])) };
    expect(attackerPool(CTX, state, "axis", []).map((u) => u.id)).toEqual(["g1"]);
    const atWar = { ...state, nations: { ...state.nations, italy: { ...state.nations.italy, status: "axis" as const } } };
    expect(attackerPool(CTX, atWar, "axis", []).map((u) => u.id).sort()).toEqual(["g1", "it1"]);
  });
});

describe("ground movement stops at an enemy ZOC but goes on from a hex that has none (Ref 6.0)", () => {
  it("a German stack at M32, next to a Polish unit, reaches M31 and M30 beyond it; ZOC hexes can be entered", () => {
    const g = counter("g1", "germany", "infantry", 3, "M32", 3);
    const p = counter("p1", "poland", "infantry", 2, "M33", 3);
    const reach = reachableHexes(CTX, board([g, p], SCENARIO_1939, { activeSide: "axis" }), [g]);
    expect(reach.has("M31")).toBe(true);
    expect(reach.has("M30")).toBe(true);
    expect(reach.has("L33")).toBe(true); // a hex inside the Polish ZOC can be entered
    expect(reach.has("L32")).toBe(true);
    expect(reach.has("K32")).toBe(true); // ...and from L32, outside the ZOC, the stack goes on
  });
});

describe("BRP grants (Ref 11.71)", () => {
  const ctx42 = ctxFor(SCENARIO_1942);
  const allied42 = (): GameState => ({ ...atStart(SCENARIO_1942, 1), activeSide: "allies", position: { part: "player-turn", turn: 2, step: "9a" } });
  const grant = (s: GameState, amount: number) => applyAction(ctx42, s, { type: "GRANT_BRPS", from: "britain", to: "usa", amount });

  it("any whole number of BRPs from 1 up to the room is a grant; zero, a negative or a fraction is not", () => {
    expect(grant(allied42(), 1)).toMatchObject({ ok: true });
    for (const bad of [0, -1, 0.5, 1.5, Number.NaN]) expect(grant(allied42(), bad), String(bad)).toMatchObject({ ok: false });
    const r = applyGrant(allied42(), { type: "GRANT_BRPS", from: "britain", to: "usa", amount: 1 });
    expect(r.ok && r.state.grants).toEqual([{ from: "britain", to: "usa", amount: 1 }]);
  });

  it("a block on one pair (the U.S.S.R. may not grant to Britain) does not block other givers to the same receiver", () => {
    const s: GameState = { ...allied42(), noGrants: [["ussr", "britain"]] };
    expect(grantRoom(s, "ussr", "britain")).toBe(0);
    expect(grantRoom(s, "usa", "britain")).toBeGreaterThan(0);
    expect(grantRoom(s, "britain", "ussr")).toBeGreaterThan(0); // the block is one-way
    expect(grantRoom(s, "ussr", "usa")).toBeGreaterThan(0); // and it names one receiver, not all of them
  });

  it("the no-handing-back record holds each pair once, however many grants are made", () => {
    const first = applyGrant(allied42(), { type: "GRANT_BRPS", from: "britain", to: "usa", amount: 10 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyGrant(first.state, { type: "GRANT_BRPS", from: "britain", to: "usa", amount: 10 });
    expect(second.ok && second.state.noGrants).toEqual([["usa", "britain"]]);
  });

  it("each grant adds its own pair: two givers to one receiver, and one giver to two receivers", () => {
    const toUssr = applyGrant(allied42(), { type: "GRANT_BRPS", from: "britain", to: "ussr", amount: 10 });
    if (!toUssr.ok) throw new Error(toUssr.error);
    const both = applyGrant(toUssr.state, { type: "GRANT_BRPS", from: "usa", to: "ussr", amount: 10 });
    expect(both.ok && both.state.noGrants).toEqual([["ussr", "britain"], ["ussr", "usa"]]);
    const toUsa = applyGrant(toUssr.state, { type: "GRANT_BRPS", from: "britain", to: "usa", amount: 10 });
    expect(toUsa.ok && toUsa.state.noGrants).toEqual([["ussr", "britain"], ["usa", "britain"]]);
  });
});

describe("an Exchange with equal totals takes everything (Ref 12.2)", () => {
  const seedRolling = (n: number) => {
    for (let seed = 1; seed < 10000; seed++) if (rollD6(seed).roll === n) return seed;
    throw new Error("no seed");
  };
  it("6 attacking factors against 3 doubled on plain (6): both stacks are eliminated and nobody chooses", () => {
    const units: Unit[] = [counter("g1", "germany", "infantry", 6, "M32"), counter("p1", "poland", "infantry", 3, "M33")];
    const s: GameState = {
      ...atStart(SCENARIO_1939, 1),
      activeSide: "axis",
      position: { part: "player-turn", turn: 1, step: "7h" },
      units: Object.fromEntries(units.map((u) => [u.id, u])),
      rngState: seedRolling(1), // roll 1 is an Exchange in every column
    };
    const r = applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.units).toEqual({});
    expect(combatOf(r.state).pending).toBeNull();
  });
});

describe("British and French in one hex before 1942 are listed apart (Ref 26.0)", () => {
  const inf = (id: string, at: string, owner: Unit["owner"]) => counter(id, owner, "infantry", 2, at, 3);
  it("only a hex holding both is listed, not one holding two French, two British or a British and a German", () => {
    const units = [
      inf("b5", "O27", "britain"), inf("f5", "O27", "france"), // listed first, to show the result is in hex order
      inf("f1", "O22", "france"), inf("f2", "O22", "france"),
      inf("b1", "O23", "britain"), inf("b2", "O23", "britain"),
      inf("b3", "O24", "britain"), inf("g1", "O24", "germany"),
      inf("f3", "O25", "france"), inf("g2", "O25", "germany"),
      inf("b4", "O26", "britain"), inf("f4", "O26", "france"),
    ];
    expect(angloFrenchHexes(CTX, board(units))).toEqual(["O26", "O27"]);
  });

  it("the ban ends with 1941: a shared hex in 1941 is listed, one in 1942 is not", () => {
    const pair = [inf("b1", "O22", "britain"), inf("f1", "O22", "france")];
    expect(angloFrenchHexes(CTX, board(pair, SCENARIO_1939, { year: 1941 }))).toEqual(["O22"]);
    expect(angloFrenchHexes(CTX, board(pair, SCENARIO_1939, { year: 1942 }))).toEqual([]);
  });
});

describe("France and the U.S. may grant BRPs from Spring 1942, not before (Ref 11.71)", () => {
  const ctxState = (year: number, season: GameState["season"]): GameState => ({ ...atStart(SCENARIO_1942, 1), activeSide: "allies", year, season });
  it("Winter 1941 is refused; Spring 1942 is allowed", () => {
    expect(grantRoom(ctxState(1941, "winter"), "usa", "britain")).toBe(0);
    expect(grantRoom(ctxState(1941, "fall"), "france", "britain")).toBe(0);
    expect(grantRoom(ctxState(1942, "spring"), "usa", "britain")).toBeGreaterThan(0);
  });
});

describe("building counters at step 8b (Ref 11.6)", () => {
  const at8b = (): GameState => {
    const at3 = applyAction(CTX, atStart(SCENARIO_1939, 1), { type: "END_STEP", side: "axis", step: "1" });
    if (!at3.ok) throw new Error(at3.error);
    const at8 = applyAction(CTX, at3.state, { type: "END_STEP", side: "axis", step: "3" });
    if (!at8.ok) throw new Error(at8.error);
    return at8.state;
  };
  const home = () => Object.values(CTX.map.hexes).filter((h) => h.land && h.country === "germany" && !h.features.includes("capital")).map((h) => h.id);

  it("two counters built one after the other are two different counters", () => {
    const [a, b] = home();
    const before = at8b();
    let state = before;
    for (const at of [a!, b!]) {
      const r = applyBuild(CTX, state, { type: "BUILD", owner: "germany", unit: { type: "infantry", strength: 3 }, at });
      if (!r.ok) throw new Error(r.error);
      state = r.state;
    }
    const built = Object.values(state.units).filter((u) => !before.units[u.id]);
    expect(built.map((u) => u.at).sort()).toEqual([a!, b!].sort());
    expect(new Set(built.map((u) => u.id)).size).toBe(2);
    expect(Object.keys(state.units).length).toBe(Object.keys(before.units).length + 2);
  });

  it("a nation on the side that is not moving may not build", () => {
    const r = applyBuild(CTX, at8b(), { type: "BUILD", owner: "britain", unit: { type: "infantry", strength: 3 }, at: "K24" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/not on the axis side/);
  });
});

describe("declaring war (Ref 13.0, 10.0)", () => {
  it("only a nation on the side to move may declare", () => {
    const s = { ...atStart(SCENARIO_1939, 1), activeSide: "axis" as const };
    const r = applyDeclaration(CTX, s, { type: "DECLARE_WAR", by: "britain", on: "germany" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/not on the axis side/);
  });

  it("a declaration that costs exactly what the nation may still spend is offered; one BRP less is not", () => {
    const s = atStart(SCENARIO_1939, 1);
    const withBrps = (n: number): GameState => ({ ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal: n, spendLimit: 75, spent: 0 } } });
    expect(declarationTargets(CTX, withBrps(10), "germany")).toContain("norway"); // 10 BRPs: a minor country
    expect(declarationTargets(CTX, withBrps(9), "germany")).not.toContain("norway");
    const majors = (n: number) => declarationTargets(CTX, withBrps(n), "germany").filter((t) => t === "usa" || t === "ussr");
    expect(majors(35)).toEqual(expect.arrayContaining(["usa", "ussr"])); // 35 BRPs: a Major Power
    expect(majors(34)).toEqual([]);
  });
});
