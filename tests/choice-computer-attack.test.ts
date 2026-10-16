import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { combatOf } from "../src/engine/combat-record";
import { attacking } from "../src/ui/attackTap";
import { confirmLosses, pickedLosses, pickLossWay } from "../src/ui/choiceTap";
import { choiceHtml } from "../src/ui/choiceView";
import { computerTick, computerToMove } from "../src/ui/computerPlay";
import { nextText } from "../src/ui/nextBar";
import { createSession, run, type Session } from "../src/ui/session";
import { at7h, GER, POL } from "./preview-helpers";

/**
 * The computer attacks and the human (the Allies) chooses the losses (Ref 12.2). Two German 3-factor counters attack Poznan (M33), held by
 * Poles of 1, 2 and 3 strength (2, 4 and 6 factors at the city's multiple). The attackers have fewer factors, so the defenders lose the
 * attack's 6 factors and the Allied player chooses which Poles go: the 3-factor Pole, or the 1- and 2-factor Poles.
 *
 * The computer's own choice to attack is not the AI here: the engine lists this attack at these odds and the AI declines it, so the test plays
 * the computer's ATTACK action (the same action it could take), then checks what the human sees and sends.
 */

const units = [GER("g1", "M32", 3), GER("g2", "M32", 3), POL("p1", "M33", 1), POL("p2", "M33", 2), POL("p3", "M33", 3)];
const acts = (s: Session) => legalActions(s.ctx, s.state);
const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/** The game with the computer's attack made: the first dice seed whose result is an Exchange the Allies must settle. */
function attacked(): Session {
  for (let seed = 1; seed < 200; seed++) {
    const s = createSession(SCENARIO_1939, "allies", seed);
    s.state = at7h(units, seed); // the Axis (the computer) to move at step 7h
    s.record = [];
    const atk = legalActions(s.ctx, s.state).find((a): a is Extract<Action, { type: "ATTACK" }> => a.type === "ATTACK" && a.target === "M33" && a.units.length === 2);
    if (atk && run(s, atk) && combatOf(s.state).pending) {
      s.record = []; // only what the human sends from here on
      return s;
    }
  }
  throw new Error("no seed gives an Exchange for the Allies");
}

describe("the computer attacks; the human Allies choose the losses (Ref 12.2)", () => {
  it("the Exchange waits for the human: the loss card shows the Allied ways and the computer does not play on", () => {
    const s = attacked();
    expect(combatOf(s.state).pending).toMatchObject({ chooser: "allies", target: "M33", required: 6, candidates: ["p1", "p2", "p3"] });
    expect(s.state.activeSide).toBe("axis"); // the computer's Player Turn, still at step 7h
    expect(computerToMove(s)).toBe(false);
    expect(attacking(s)).toBe(true); // the human may act on the card
    const a = acts(s);
    expect(a.every((x) => x.type === "ALLOCATE_LOSSES" && x.side === "allies")).toBe(true);
    const text = plain(choiceHtml(s, a));
    expect(text).toContain("Choose your losses");
    expect(text).toContain("at least 6 factors of your units must be lost");
    expect(text).toContain("Lose 3 Polish infantry (6 factors)");
    expect(text).toContain("Lose 1 Polish infantry, 2 Polish infantry (6 factors)");
    expect(text).not.toMatch(/\bp\d\b/); // no raw ids
    expect(nextText(s, a)).toBe("Next: choose your losses.");
    expect(computerTick(s, 1e9, () => 0)).toBe("stuck"); // the computer waits for the human's losses
  });

  it("confirming a legal set sends ALLOCATE_LOSSES for side allies, and then the turn goes on", () => {
    const s = attacked();
    pickLossWay(s, 0); // the first way: the 3-factor Pole
    const picked = pickedLosses(s);
    expect(picked).toEqual(["p3"]);
    const before = s.state;
    const sent: Action = { type: "ALLOCATE_LOSSES", side: "allies", units: picked };
    expect(acts(s)).toContainEqual(sent); // the engine lists exactly this set
    const expected = applyAction(s.ctx, before, sent);
    expect(expected.ok).toBe(true);
    confirmLosses(s);
    expect(s.record).toEqual([sent]); // the one action the card sent
    expect(s.state).toEqual(expected.ok ? expected.state : null);
    expect(combatOf(s.state).pending).toBeNull();
    expect(s.state.units["p3"]).toBeUndefined();
    expect(s.state.units["p1"]).toBeDefined();
    expect(s.state.units["p2"]).toBeDefined();
    expect(Object.values(s.state.units).some((u) => u.owner === "germany")).toBe(false); // the two attackers lost the attack
    // The turn passes on: the computer's step 7h is over and its next step is played.
    expect(computerToMove(s)).toBe(true);
    expect(computerTick(s, 1e9, () => 0)).toBe("done");
    expect(s.state.position).toMatchObject({ step: "8b" });
  });

  it("only the Allies may choose: the computer's own side is refused, and so are sets that take too little or too much", () => {
    const s = attacked();
    const send = (side: "axis" | "allies", ids: string[]) => applyAction(s.ctx, s.state, { type: "ALLOCATE_LOSSES", side, units: ids });
    expect(send("axis", ["p3"]).ok, "the attacker does not choose the defenders' losses").toBe(false);
    expect(send("allies", ["p1"]).ok, "1 factor of the 6 the Exchange takes").toBe(false);
    expect(send("allies", ["p1", "p2", "p3"]).ok, "a unit could be spared").toBe(false);
    expect(send("allies", ["g1"]).ok, "not one of the stack that loses").toBe(false);
    expect(send("allies", ["p3"]).ok).toBe(true);
    expect(acts(s).some((a) => a.type === "ALLOCATE_LOSSES" && a.side === "axis")).toBe(false);
  });
});
