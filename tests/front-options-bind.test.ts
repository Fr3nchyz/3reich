import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/engine/actions";
import { frontAllowsAttack } from "../src/engine/attack-rules";
import { attackables } from "../src/engine/attack";
import { FRONTS, noOffensiveText, resetFrontOptions, withOffensive } from "../src/engine/frontoptions";
import { attackPreview } from "../src/ui/attackPreview";
import { noOffensiveText as uiText } from "../src/ui/attackText";
import { CTX } from "./helpers";
import { GER, POL, at7h } from "./preview-helpers";
import type { Action } from "../src/engine/actions";
import type { GameState } from "../src/engine/types";

// Spec 16 Q1, ticket 16-2: an attack needs the Offensive Option the attacking side chose at step 3 this Player Turn (Ref 11.2, 11.21).
// M32 (German) is next to M33 (Poznan, Polish), on the Eastern Front.
const board = (): GameState => at7h([GER("g1", "M32", 3), POL("p1", "M33", 1)]);
const without = (s: GameState, option?: "attrition" | "defensive"): GameState => ({ ...s, frontOptions: option ? { eastern: { option } } : {} });
const attack: Action = { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" };

describe("frontAllowsAttack reads the Option (Ref 11.21)", () => {
  it("allows only the Offensive Option of the side to move on that Front", () => {
    const s = board();
    expect(frontAllowsAttack(CTX, s, "axis", "eastern")).toBe(true);
    expect(frontAllowsAttack(CTX, without(s, "attrition"), "axis", "eastern")).toBe(false);
    expect(frontAllowsAttack(CTX, without(s, "defensive"), "axis", "eastern")).toBe(false);
  });
  it("a Front with no choice is Defensive: no attack (TODO(verify) E8)", () => {
    expect(frontAllowsAttack(CTX, without(board()), "axis", "eastern")).toBe(false);
  });
  it("the Option is per Front: the Offensive Option on the Western Front does not open the Eastern one", () => {
    const s = { ...board(), frontOptions: {} };
    const w = withOffensive(s, "western");
    expect(frontAllowsAttack(CTX, w, "axis", "western")).toBe(true);
    expect(frontAllowsAttack(CTX, w, "axis", "eastern")).toBe(false);
  });
  it("the side not to move has no Option", () => {
    expect(frontAllowsAttack(CTX, board(), "allies", "eastern")).toBe(false);
  });
  it("last turn's Options lapse when a Player Turn begins", () => {
    expect(frontAllowsAttack(CTX, resetFrontOptions(board()), "axis", "eastern")).toBe(false);
  });
});

describe("what the engine does without the Offensive Option", () => {
  it("lists the attack with the Option and not without it or under Attrition", () => {
    const has = (s: GameState) => legalActions(CTX, s).some((a) => a.type === "ATTACK");
    expect(has(board())).toBe(true);
    expect(has(without(board()))).toBe(false);
    expect(has(without(board(), "attrition"))).toBe(false);
    expect(attackables(CTX, without(board())).size).toBe(0);
  });
  it("refuses the ATTACK with the reason, and nothing changes", () => {
    const s = without(board(), "defensive");
    const r = applyAction(CTX, s, attack);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("You did not choose the Offensive Option on the Eastern Front. It can be chosen only at step 3.");
    expect(applyAction(CTX, board(), attack).ok).toBe(true);
  });
  it("the attack card says the same words", () => {
    const p = attackPreview(CTX, without(board()), "M33", ["g1"]);
    expect(p.problems).toEqual([noOffensiveText("eastern")]);
    expect(uiText("eastern")).toBe(noOffensiveText("eastern"));
  });
  it("all three Fronts are named in the words", () => {
    for (const f of FRONTS) expect(noOffensiveText(f)).toContain(`${f[0]!.toUpperCase()}${f.slice(1)} Front`);
  });
});
