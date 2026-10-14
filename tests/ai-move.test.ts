import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { distanceToEnemyObjective, isObjective, objectiveHexes } from "../src/ai/geo";
import { MOVE_MAX_UNITS_PER_TURN } from "../src/ai/move";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { turnKey } from "../src/engine/combat-record";
import { adjacentHexes } from "../src/engine/zoc";
import type { GameState } from "../src/engine/types";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

// The computer's movement at step 6f is POLICY (spec 05, docs/RULES.md "Computer opponent policy"), not a rule: every
// position is on the real map (L32-L35 a row of German then Polish plain, M35 Warsaw, O22 Paris, L31 Berlin).

type Move = Extract<Action, { type: "MOVE" }>;
const dest = (a: Move) => a.path[a.path.length - 1]!;
const decide = (s: GameState, seed = 1) => chooseAction(CTX, s, { seed })!;
const field = (s: GameState, owner: "germany" | "france" = "germany", side: "axis" | "allies" = "axis") => distanceToEnemyObjective(CTX, s, owner, side);

describe("where the computer heads (geo.ts)", () => {
  it("objectives are the capitals and objective cities, and the distance counts ground hexes to the nearest enemy-held one", () => {
    expect(objectiveHexes(CTX)).toContain("M35");
    expect(isObjective(CTX, "M35")).toBe(true);
    expect(isObjective(CTX, "M33")).toBe(false);
    const s = at6f([inf("u1", "germany", "M34")]);
    const d = field(s);
    expect(d.get("M35")).toBe(0); // Warsaw is Polish-held and an objective
    expect(d.get("M34")).toBe(1);
    expect(d.get("K23")).toBe(0); // London is a target of the Axis too
  });

  it("an objective the side already holds is not a target", () => {
    const s = at6f([inf("u1", "germany", "M34")]);
    expect(field(s, "germany", "axis").get("L31")).not.toBe(0); // Berlin: German
    expect(field(s, "france", "allies").get("L31")).toBe(0); // ...but a target for the Allies
  });
});

describe("neutral land (geo.ts)", () => {
  it("a neutral country is no route to an objective until the owner is at war with it", () => {
    const s = at6f([inf("u1", "germany", "M31")]);
    expect(field(s).has("M26")).toBe(false); // Belgium, neutral in 1939
    expect(field(s).has("N25")).toBe(false);
    const war: GameState = { ...s, wars: [...s.wars, ["germany", "belgium"]] };
    expect(field(war).has("M26")).toBe(true);
  });
});

describe("step 6f: movement toward the nearest enemy objective", () => {
  it("moves to the legal hex nearest the enemy objective, taken from the legal list", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3)]);
    const d = decide(s);
    expect(legalActions(CTX, s)).toContainEqual(d.action);
    expect(d.action.type).toBe("MOVE");
    const f = field(s);
    const legal = legalActions(CTX, s).filter((a): a is Move => a.type === "MOVE");
    expect(f.get(dest(d.action as Move))).toBe(Math.min(...legal.map((m) => f.get(dest(m)) ?? 99)));
    expect(f.get(dest(d.action as Move))!).toBeLessThan(f.get("L32")!);
    expect(d.why).toMatch(/closer to the nearest enemy-held objective/);
  });

  it("moves a stack together rather than its units one by one, when they reach the same hex", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3), inf("u2", "germany", "L32", 3, 3)]);
    expect((decide(s).action as Move).units).toEqual(["u1", "u2"]);
  });

  it("ends the step when no move gets closer (standing on the objective)", () => {
    const s = at6f([inf("u1", "germany", "M35", 3, 3)]);
    expect(legalActions(CTX, s).some((a) => a.type === "MOVE")).toBe(true);
    expect(decide(s).action).toEqual({ type: "END_STEP", side: "axis", step: "6f" });
  });

  it("ends the step when no unit is on land that reaches an enemy objective (a unit on an island)", () => {
    const s = at6f([inf("u1", "britain", "K23", 3, 3)], "allies");
    expect(field(s, "france", "allies").has("K23")).toBe(false);
    expect(decide(s).action).toEqual({ type: "END_STEP", side: "allies", step: "6f" });
  });

  it("keeps a lone garrison on its own capital, and moves the others", () => {
    const alone = at6f([inf("u1", "france", "O22", 3, 3)], "allies");
    expect(legalActions(CTX, alone).some((a) => a.type === "MOVE")).toBe(true);
    expect(decide(alone).action.type).toBe("END_STEP");
    const two = at6f([inf("u1", "france", "O22", 3, 3), inf("u2", "france", "O22", 3, 3)], "allies");
    const d = decide(two).action as Move;
    expect(d.type).toBe("MOVE");
    expect(d.units).toHaveLength(1); // one stays: the whole stack leaving is refused, a single unit may go
  });

  it("does not end a move next to enemy ground factors worth more than twice its own there", () => {
    // 12 Polish factors in M34. From L33 the only gains are L34 and M33, both beside them: a weak unit stays, a strong stack goes.
    const pol = [inf("p1", "poland", "M34", 6, 3), inf("p2", "poland", "M34", 6, 3)];
    const weak = at6f([inf("u1", "germany", "L33", 1, 1), ...pol]);
    expect(legalActions(CTX, weak).some((a) => a.type === "MOVE" && adjacentHexes(CTX, "M34").includes(dest(a)))).toBe(true);
    expect(decide(weak).action).toEqual({ type: "END_STEP", side: "axis", step: "6f" });
    const strong = at6f([inf("u1", "germany", "L33", 7, 1), ...pol]);
    expect(adjacentHexes(CTX, "M34")).toContain(dest(decide(strong).action as Move));
  });

  it("stops after the unit cap, however many moves remain", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3)]);
    expect(decide(s).action.type).toBe("MOVE");
    const capped: GameState = { ...s, moves: { turn: turnKey(s), moved: Array.from({ length: MOVE_MAX_UNITS_PER_TURN }, (_, i) => `x${i}`) } };
    expect(decide(capped).action.type).toBe("END_STEP");
  });

  it("is deterministic for a seed and every move it makes is accepted by the engine", () => {
    let s = at6f([inf("u1", "germany", "L32", 3, 3), inf("u2", "germany", "M31", 3, 3), inf("u3", "germany", "N32", 2, 4, "armor")]);
    expect(JSON.stringify(decide(s, 3).action)).toBe(JSON.stringify(decide(s, 3).action));
    for (let n = 0; n < 10 && s.position?.part === "player-turn" && s.position.step === "6f"; n++) {
      const d = decide(s);
      const r = applyAction(CTX, s, d.action);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(s.position).toMatchObject({ step: expect.not.stringMatching(/^6f$/) });
    expect(Object.values(s.units).every((u) => u.at !== "L32" && u.at !== "M31" && u.at !== "N32")).toBe(true);
  });
});
