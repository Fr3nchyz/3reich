import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { SIBERIAN_TAKE_ALL, chooseSiberian } from "../src/ai/siberian";
import { applyAction, legalActions } from "../src/engine/actions";
import type { GameState } from "../src/engine/types";
import { distance, hex } from "../src/engine/hex";
import { counter } from "./board";
import { CTX } from "./helpers";
import { at8a, GORKI, KAZAN, MOSCOW, takeAll, withPool } from "./helpers-siberian";

// Spec 14 ticket 14-18, part E: the computer's minimal answer at step 8a (the full policy set is ticket 14-19). It takes every unit on offer, infantry first, the biggest counter,
// in the city nearest an Axis ground unit; it ends the step when nothing is left; it never loops and never asks the engine for more than the list offers.

const cfg = { seed: 1 };
const legal = (s: GameState) => legalActions(CTX, s);
const pick = (s: GameState, takeAll?: boolean) => chooseSiberian(CTX, s, legal(s), cfg, takeAll);

describe("the choice", () => {
  it("the policy is a constant: take everything", () => {
    expect(SIBERIAN_TAKE_ALL).toBe(true);
  });

  it("takes infantry before armor and the biggest counter first", () => {
    const s = takeAll(at8a(), [["infantry", 1, MOSCOW]]); // armor is on offer now
    expect(legal(s).some((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "armor")).toBe(true);
    const d = pick(s)!;
    expect(d.action).toMatchObject({ type: "SIBERIAN_TRANSFER", side: "allies", unit: { type: "infantry", strength: 3 } });
    expect(d.why).toMatch(/^Free Siberian Transfer: takes a 3-factor infantry from the Russian pool/);
  });

  it("takes armor when no infantry is left to take", () => {
    const s = takeAll(withPool(at8a(), [{ type: "infantry", strength: 2, movement: 3, count: 1 }, { type: "armor", strength: 3, movement: 5, count: 2 }]), [["infantry", 2, MOSCOW]]);
    expect(pick(s)!.action).toMatchObject({ unit: { type: "armor", strength: 3 } });
  });

  it("puts it in the Russian city nearest an Axis ground unit", () => {
    const s = at8a([counter("g1", "germany", "infantry", 3, "F52", 3)]);
    const d = pick(s)!;
    const at = (d.action as { at: string }).at;
    const near = (h: string) => distance(hex(h), hex("F52"));
    const offered = legal(s).filter((a) => a.type === "SIBERIAN_TRANSFER").map((a) => (a as { at: string }).at);
    expect(near(at)).toBe(Math.min(...offered.map(near)));
    expect(d.why).toMatch(/hexes? from the nearest enemy\.$/);
  });

  it("the same position and seed give the same choice; the choice depends on nothing else", () => {
    const s = at8a();
    expect(pick(s)).toEqual(pick(s));
    expect(chooseSiberian(CTX, s, legal(s), { seed: 7 })!.action).toMatchObject({ type: "SIBERIAN_TRANSFER" });
  });

  it("with the policy off it takes nothing (the caller ends the step)", () => {
    expect(pick(at8a(), false)).toBeUndefined();
  });

  it("nothing to take, nothing chosen", () => {
    const s = withPool(at8a(), []);
    expect(chooseSiberian(CTX, s, legal(s), cfg)).toBeUndefined();
  });
});

describe("through chooseAction", () => {
  it("takes the quota one unit at a time, then ends the step, and never stalls", () => {
    let s = at8a([counter("g1", "germany", "infantry", 3, "F52", 3)]);
    const kinds: string[] = [];
    for (let i = 0; i < 20 && s.position?.part === "player-turn" && s.position.step === "8a"; i++) {
      const d = chooseAction(CTX, s, cfg);
      expect(d, "the computer always has an action at 8a").not.toBeNull();
      kinds.push(d!.action.type);
      const r = applyAction(CTX, s, d!.action);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(kinds).toEqual(["SIBERIAN_TRANSFER", "SIBERIAN_TRANSFER", "SIBERIAN_TRANSFER", "SIBERIAN_TRANSFER", "END_STEP"]);
    expect(s.position).toMatchObject({ step: "8b" });
    expect(s.siberian?.taken).toEqual({ "1941-winter": 4 });
  });

  it("with only the way on listed it ends the step and says why", () => {
    const s = withPool(at8a(), [{ type: "armor", strength: 3, movement: 5, count: 3 }]); // armor alone cannot be taken: nothing on offer
    const d = chooseAction(CTX, { ...s, position: { part: "player-turn", turn: 2, step: "8a" } }, cfg)!;
    expect(d.action).toEqual({ type: "END_STEP", side: "allies", step: "8a" });
    expect(d.why).toBe("Nothing more to take in the Free Siberian Transfer.");
  });

  it("the Kazan and Gorki cities are among the places it may choose (a sanity check of the list)", () => {
    const places = legal(at8a()).filter((a) => a.type === "SIBERIAN_TRANSFER").map((a) => (a as { at: string }).at);
    expect(places).toEqual(expect.arrayContaining([KAZAN, GORKI, MOSCOW]));
  });
});
