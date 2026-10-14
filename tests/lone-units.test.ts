import { describe, expect, it } from "vitest";
import { ALONE_NONGROUND_DESTROYED } from "../src/engine/attack-rules";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { combatOf } from "../src/engine/combat-record";
import { chooseAttack } from "../src/ai/assault";
import type { GameState, Unit, UnitType, ForceOwner } from "../src/engine/types";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { CTX, atStart } from "./helpers";

/**
 * Air units, fleets and airbases left alone in a hex (the Warsaw case of docs/FEEDBACK.md, 2 (2026-10-14)): they cannot defend on
 * the ground, and used to stay for ever, so the hex could never be attacked, entered or advanced into. ALONE_NONGROUND_DESTROYED
 * (TODO(verify): Ref 12.x text not in the repo) destroys them when ground units attack the hex or when a battle there removes the last
 * ground defenders.
 */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at });
const at7h = (units: Unit[], seed = 1): GameState => ({
  ...atStart(SCENARIO_1939, 1),
  activeSide: "axis",
  position: { part: "player-turn", turn: 1, step: "7h" },
  units: Object.fromEntries(units.map((u) => [u.id, u])),
  rngState: seed,
});
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const attack = (s: GameState, units: string[], target: string) => applyAction(CTX, s, { type: "ATTACK", side: "axis", units, target });
const stacks = (s: GameState, hex: string) => Object.values(s.units).filter((u) => u.at === hex).map((u) => u.id);
const WARSAW = (): Unit[] => [unit("p1", "poland", "infantry", 2, "M35"), unit("p2", "poland", "infantry", 2, "M35"), unit("a1", "poland", "air", 1, "M35"), unit("a2", "poland", "air", 1, "M35")];

/** First seed (from 1) for which the attack of g1+g2 on Warsaw ends as `outcome`. */
const seedFor = (units: Unit[], ids: string[], pick: (s: GameState, events: ReturnType<typeof ok>["events"]) => boolean): number => {
  for (let seed = 1; seed < 5000; seed++) {
    const s = at7h(units, seed);
    const r = attack(s, ids, "M35");
    if (r.ok && pick(r.state, r.events)) return seed;
  }
  throw new Error("no seed");
};

describe("air units and fleets alone in a hex (ALONE_NONGROUND_DESTROYED, TODO(verify))", () => {
  it("is on", () => expect(ALONE_NONGROUND_DESTROYED).toBe(true));

  it("an attack on a hex with only air units, an airbase or a fleet is listed and destroys them without a roll", () => {
    const s = at7h([unit("g1", "germany", "infantry", 3, "M34"), unit("a1", "poland", "air", 3, "M35"), unit("b1", "poland", "airbase", 1, "M35"), unit("f1", "poland", "fleet", 2, "M35")]);
    expect(legalActions(CTX, s)).toContainEqual({ type: "ATTACK", side: "axis", units: ["g1"], target: "M35" });
    const r = ok(attack(s, ["g1"], "M35"));
    expect(r.state.rngState).toBe(s.rngState); // no die rolled
    expect(r.events.find((e) => e.type === "COMBAT_RESOLVED")).toMatchObject({ attackers: ["g1"], defenseFactors: 0, rounds: [], outcome: "defender-eliminated" });
    expect(r.events.filter((e) => e.type === "UNIT_ELIMINATED")).toHaveLength(3);
    expect(stacks(r.state, "M35")).toEqual([]);
    expect(combatOf(r.state)).toMatchObject({ attacked: ["g1"], targets: ["M35"], advances: [{ to: "M35", units: ["g1"] }] });
    expect(legalActions(CTX, r.state)).toContainEqual({ type: "ADVANCE", side: "axis", units: ["g1"], to: "M35" });
    // The hex has been attacked this turn (one attack per hex) and g1 has attacked: nothing more is listed against it.
    expect(legalActions(CTX, r.state).some((a) => a.type === "ATTACK")).toBe(false);
  });

  it("the Warsaw case: 2 infantry and 2 air units; when the infantry fall the air units go with them and the attackers can advance", () => {
    const base = [unit("g1", "germany", "infantry", 4, "M34"), unit("g2", "germany", "infantry", 4, "L35"), ...WARSAW()];
    const seed = seedFor(base, ["g1", "g2"], (s, ev) => ev.some((e) => e.type === "COMBAT_RESOLVED" && e.outcome === "defender-eliminated") && stacks(s, "M35").length === 0);
    const r = ok(attack(at7h(base, seed), ["g1", "g2"], "M35"));
    expect(r.events.filter((e) => e.type === "UNIT_ELIMINATED").map((e) => (e as { unitId: string }).unitId).sort()).toEqual(["a1", "a2", "p1", "p2"]);
    expect(legalActions(CTX, r.state).filter((a) => a.type === "ADVANCE").length).toBeGreaterThan(0);
  });

  it("the air units go too when the Exchange is settled by ALLOCATE_LOSSES", () => {
    const base = [unit("g1", "germany", "infantry", 3, "M34"), unit("g2", "germany", "infantry", 3, "L35"), unit("g3", "germany", "infantry", 3, "L36"), ...WARSAW()];
    const seed = seedFor(base, ["g1", "g2", "g3"], (s) => combatOf(s).pending !== null);
    const waiting = ok(attack(at7h(base, seed), ["g1", "g2", "g3"], "M35")).state;
    expect(stacks(waiting, "M35").sort()).toEqual(["a1", "a2"]); // the infantry are gone, the choice is the attackers'
    const choice = legalActions(CTX, waiting).find((a): a is Extract<Action, { type: "ALLOCATE_LOSSES" }> => a.type === "ALLOCATE_LOSSES")!;
    const r = ok(applyAction(CTX, waiting, choice));
    expect(stacks(r.state, "M35")).toEqual([]);
    const gone = r.events.filter((e) => e.type === "UNIT_ELIMINATED").map((e) => (e as { unitId: string }).unitId);
    expect(gone).toEqual(expect.arrayContaining(["a1", "a2"]));
  });

  it("when the attack fails the ground defenders hold and so do the air units", () => {
    const base = [unit("g1", "germany", "infantry", 1, "M34"), ...WARSAW()];
    const seed = seedFor(base, ["g1"], (s, ev) => ev.some((e) => e.type === "COMBAT_RESOLVED" && e.outcome === "attacker-eliminated") && stacks(s, "M35").length === 4);
    expect(stacks(ok(attack(at7h(base, seed), ["g1"], "M35")).state, "M35")).toHaveLength(4);
  });

  it("counters of a power not at war with the attackers are not attacked or destroyed", () => {
    const s = at7h([unit("g1", "germany", "infantry", 3, "M34"), unit("a1", "ussr", "air", 3, "M35")]);
    expect(legalActions(CTX, s).some((a) => a.type === "ATTACK")).toBe(false);
    expect(attack(s, ["g1"], "M35")).toMatchObject({ ok: false });
  });

  it("the computer takes the free sweep", () => {
    const s = at7h([unit("g1", "germany", "infantry", 3, "M34"), unit("a1", "poland", "air", 3, "M35")]);
    expect(chooseAttack(CTX, s, legalActions(CTX, s), { seed: 1 })?.action).toEqual({ type: "ATTACK", side: "axis", units: ["g1"], target: "M35" });
  });
});
