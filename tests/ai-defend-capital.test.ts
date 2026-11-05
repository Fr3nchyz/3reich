import { describe, expect, it } from "vitest";
import { capitalThreat, defendCapital, opensObjective } from "../src/ai/geo";
import { chooseMove } from "../src/ai/move";
import { applyAction, legalActions } from "../src/engine/actions";
import { hex, hexsideId } from "../src/engine/hex";
import type { GameContext } from "../src/engine/context";
import type { ForceOwner } from "../src/engine/types";
import { turnKey } from "../src/engine/combat-record";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

// Spec 05 Defend Berlin: computer policy AER56/AER57; combat multipliers Ref 4.5-4.9, 12.1.
const position = () => at6f([
  inf("u1", "germany", "L31", 1),
  inf("u2", "germany", "L28", 4),
  inf("e1", "france", "L34", 8),
]);

describe("Defend Berlin (spec 05)", () => {
  it("recalls a reserve before advancing and chooses a legal move", () => {
    const s = position();
    const d = defendCapital(CTX, s)!;
    expect(d.action.type).toBe("MOVE");
    expect(d.why).toContain("Defends capital L31");
    expect(legalActions(CTX, s)).toContainEqual(d.action);
    expect(applyAction(CTX, s, d.action).ok).toBe(true);
    expect(chooseMove(CTX, s, { seed: 1 })).toEqual(d);
  });
  it("does not recall when the capital is unthreatened", () => {
    const s = position();
    delete s.units.e1;
    expect(defendCapital(CTX, s)).toBeUndefined();
  });
  it("does not recall once multiplied defending factors meet the ratio", () => {
    const s = position();
    s.units.u1!.strength = 4;
    expect(capitalThreat(CTX, s, "L31").defense).toBe(8);
    expect(defendCapital(CTX, s)).toBeUndefined();
  });
  it("uses active fortress status instead of adding terrain benefits", () => {
    const s = position();
    s.fortresses.L31 = true;
    expect(capitalThreat(CTX, s, "L31").defense).toBe(4);
  });
  it("counts an enemy that can reach a neighbour in one turn, only once", () => {
    const t = capitalThreat(CTX, position(), "L31");
    expect(t.enemies.map((u) => u.id)).toEqual(["e1"]);
    expect(t.area).toContain("L32");
  });
  it("ignores enemies beyond printed movement range and neutral counters", () => {
    const s = position();
    s.units.e1!.movement = 1;
    expect(defendCapital(CTX, s)).toBeUndefined();
    s.units.e1!.movement = 3;
    s.nations.france.status = "neutral";
    expect(defendCapital(CTX, s)).toBeUndefined();
  });
  it("never recalls units in contact with enemy ground or units that attacked", () => {
    const s = position();
    s.units.e2 = inf("e2", "france", "L27", 1);
    expect(defendCapital(CTX, s)).toBeUndefined();
    delete s.units.e2;
    s.combat = { turn: turnKey(s), attacked: ["u2"], targets: [], advances: [], pending: null };
    expect(defendCapital(CTX, s)).toBeUndefined();
  });
  it("does not use future dice, enemy orders, reserves or spending", () => {
    const s = position();
    const d = defendCapital(CTX, s);
    expect(defendCapital(CTX, { ...s, rngState: 987654, nations: { ...s.nations, france: { ...s.nations.france, brpTotal: 999 } } })).toEqual(d);
  });
  it("ignores off-map reserves when measuring threats and screening recalls", () => {
    const s = position();
    s.units.e2 = inf("e2", "france", "us-box", 99);
    expect(defendCapital(CTX, s)).toEqual(defendCapital(CTX, position()));
  });
  it("is deterministic and leaves state untouched", () => {
    const s = position();
    const before = JSON.stringify(s);
    expect(defendCapital(CTX, s)).toEqual(defendCapital(CTX, s));
    expect(JSON.stringify(s)).toBe(before);
  });
  it("does not remove the blocker opening a route to a held objective", () => {
    const s = at6f([inf("u1", "germany", "L31"), inf("u2", "germany", "L32"), inf("e1", "france", "L34", 8, 2)]);
    expect(opensObjective(CTX, s, s.units.u2!)).toBe(true);
  });
});

// Spec 05 Defend Berlin: a narrow public-board corridor isolates route protection and reserve ordering.
function corridor(owner: ForceOwner = "germany"): GameContext {
  const ids = ["L26", "L27", "L28", "L29", "L30", "L31", "L32", "L33", "L34"];
  return { ...CTX, map: {
    hexes: Object.fromEntries(ids.map((id) => [id, { ...CTX.map.hexes[id]!, land: "plain", country: owner, features: id === "L31" ? ["capital"] : [] }])),
    hexsides: Object.fromEntries(ids.slice(1).map((id, i) => {
      const key = hexsideId(hex(ids[i]!), hex(id));
      return [key, { id: key, land: true, sea: false }];
    })),
  } };
}

describe("capital recall safeguards (spec 05)", () => {
  it("keeps a non-contact reserve blocking the only route to an objective", () => {
    const ctx = corridor();
    const s = at6f([inf("u1", "germany", "L31", 1), inf("u2", "germany", "L28", 4), inf("e1", "france", "L26", 8, 4), inf("e2", "france", "L34", 8)]);
    expect(capitalThreat(ctx, s, "L31").enemies).toHaveLength(1);
    expect(opensObjective(ctx, s, s.units.u2!)).toBe(true);
    expect(defendCapital(ctx, s)).toBeUndefined();
  });
  it("takes the nearest reserve first and stops recalling once reinforced", () => {
    const ctx = corridor();
    const s = position();
    s.units.u3 = inf("u3", "germany", "L29", 4);
    const d = defendCapital(ctx, s)!;
    expect(d.action).toMatchObject({ type: "MOVE", units: ["u3"], path: ["L30"] });
    const r = applyAction(ctx, s, d.action);
    expect(r.ok).toBe(true);
    if (r.ok) expect(defendCapital(ctx, r.state)).toBeUndefined();
  });
  it("defends another Major Power's capital on the Allied turn", () => {
    const ctx = corridor("france");
    const s = at6f([inf("u1", "france", "L31", 1), inf("u2", "france", "L28", 4), inf("e1", "germany", "L34", 8)], "allies");
    expect(defendCapital(ctx, s)?.action).toMatchObject({ type: "MOVE", side: "allies", units: ["u2"] });
  });
  it("does not reinforce a captured capital or a minor capital", () => {
    const s = position();
    s.control.L31 = "france";
    expect(defendCapital(CTX, s)).toBeUndefined();
    expect(defendCapital(corridor("poland"), position())).toBeUndefined();
  });
  it("uses tripled mountain defence and legal stacking at destinations", () => {
    const ctx = corridor();
    const s = position();
    const mountains = { ...ctx, map: { ...ctx.map, hexes: { ...ctx.map.hexes, L31: { ...ctx.map.hexes.L31!, land: "mountains" as const } } } };
    expect(capitalThreat(mountains, s, "L31").defense).toBe(3);
    s.units = { ...s.units };
    for (const h of ["L30", "L31", "L32"]) {
      s.units[h + "a"] = inf(h + "a", "germany", h, 0);
      s.units[h + "b"] = inf(h + "b", "germany", h, 0);
    }
    expect(defendCapital(ctx, s)).toBeUndefined();
  });
});
