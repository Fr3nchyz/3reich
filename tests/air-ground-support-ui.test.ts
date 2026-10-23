import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type GameEvent } from "../src/engine/actions";
import { airOf } from "../src/engine/air-record";
import type { GameState, Unit } from "../src/engine/types";
import { attackPreview } from "../src/ui/attackPreview";
import { airWarningHtml, committedHexes } from "../src/ui/airView";
import { openAttack } from "../src/ui/attackTap";
import { attackHtml } from "../src/ui/attackView";
import type { Session } from "../src/ui/session";
import { takeAction } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { CTX } from "./helpers";
import { atMovement } from "./helpers-move-session";
import { ALL_OFFENSIVE, at6f, inf, okOf } from "./helpers-move";

// Spec 09, ticket 09-14: the screen side of ground support. Poznan (M33) holds Polish infantry; German infantry at M32 can attack it; the planes are at J32.

const air = (id: string, at: string, strength: number): Unit => inf(id, "germany", at, strength, 4, "air");
const units = (): Unit[] => [inf("u1", "germany", "M32", 4, 3), inf("u2", "germany", "M32", 2, 3), inf("p1", "poland", "M33", 2, 3), air("a1", "J32", 3), air("a2", "J32", 2)];
const board = (step: "7b" | "7h"): GameState => at6f(units(), "axis", SCENARIO_1939, { nextUnitId: 100, frontOptions: ALL_OFFENSIVE, position: { part: "player-turn", turn: 1, step } });
const session = (step: "7b" | "7h"): Session => {
  const s = atMovement();
  s.state = board(step);
  s.moveChosen = null;
  s.toast = "";
  s.log = [];
  return s;
};

describe("step 7b on the screen", () => {
  it("shows the note and one row per hex with the planes in range, the whole-hex button in the fold-out, and the button that moves on", () => {
    const s = session("7b");
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("Air support you can add (1)");
    expect(html).toContain("A hex you commit planes to must be attacked this turn");
    expect(html).toMatch(/Poznan \(M33\)<\/span><span class="row-defence">2 planes in range \(5 air factors\); at most 18 air factors here/);
    expect(html).toMatch(/All air support as a list \(1 choice\)/);
    expect(html).toMatch(/Air support for Poznan \(M33\): .*German air.*\(5 air factors\)/); // the old one-press button, kept in the fold-out
    expect(html).toContain("Done with step 7b");
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\bu\d+\b|\ba\d\b/); // no raw id in any button or sentence
  });

  it("step 7b has its Next bar: the sentence says what to do, and Done is inside it", () => {
    const s = session("7b");
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    const bar = /<div class="actions controls nextbar"[^>]*>(.*?)<\/div>/s.exec(html)![1]!;
    expect(bar).toContain("Next: choose planes for a hex you will attack, or finish step 7b.");
    expect(bar).not.toContain("Air support for");
    expect(bar).toContain("Done with step 7b");
    takeAction(s, legalActions(s.ctx, s.state).find((a) => a.type === "DESIGNATE_AIR")!);
    const after = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(after).toContain("Next: finish step 7b.");
  });

  it("pressing the button commits the planes, logs it in words and leaves the hex to be attacked", () => {
    const s = session("7b");
    const button = legalActions(s.ctx, s.state).find((a) => a.type === "DESIGNATE_AIR")!;
    takeAction(s, button);
    expect(s.toast).toBe("");
    expect(s.log.join("\n")).toMatch(/fly ground support to Poznan \(M33\)/);
    expect(committedHexes(s)).toEqual(["M33"]);
    expect(s.log.join("\n")).not.toMatch(/\bu\d+\b/);
  });
});

describe("step 7h with air committed", () => {
  const committed = (): Session => {
    const s = session("7b");
    takeAction(s, legalActions(s.ctx, s.state).find((a) => a.type === "DESIGNATE_AIR")!);
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "7h" } };
    return s;
  };

  it("warns that the hex must be attacked, and the warning goes once it has been", () => {
    const s = committed();
    expect(airWarningHtml(s)).toMatch(/Air is committed to Poznan \(M33\): attack that hex before you finish step 7h, or the planes are lost\./);
    expect(attackHtml(s, legalActions(s.ctx, s.state))).toContain("air-warn");
    takeAction(s, legalActions(s.ctx, s.state).find((a) => a.type === "ATTACK")!);
    expect(airWarningHtml(s)).toBe("");
  });

  it("the preview counts the air, says so in the odds and in the card, and the buttons say so", () => {
    const s = committed();
    const p = attackPreview(s.ctx, s.state, "M33", ["u1", "u2"]);
    expect(p.numbers!.attackFactors).toBe(11);
    expect(p.numbers!.air).toMatchObject({ factors: 5, leftOut: [] });
    expect(p.numbers!.air!.counted).toHaveLength(2);
    expect(p.numbers!.oddsText).toMatch(/^11 \(6 on the ground and 5 in the air\) against 4/);
    expect(p.button.text).toMatch(/with 2 units and 5 air \(11 factors\)/);
    const html = attackHtml(s, legalActions(s.ctx, s.state));
    expect(html).not.toContain("attack-air"); // the card is not open yet
    expect(openAttack(s, "M33")).toBe(true);
    const open = attackHtml(s, legalActions(s.ctx, s.state));
    expect(open).toContain('id="attack-air">Air support');
    expect(open).toContain("5 air factors count in this attack");
  });

  it("the cap leaves air out and says so", () => {
    const s = committed();
    const p = attackPreview(s.ctx, s.state, "M33", ["u2"]); // 2 ground factors: at most 6 air
    expect(p.numbers!.air!.factors).toBe(5);
    const small: GameState = { ...s.state, units: { ...s.state.units, u2: { ...s.state.units.u2!, strength: 1 } } };
    const capped = attackPreview(s.ctx, { ...small, units: Object.fromEntries(Object.entries(small.units).filter(([id]) => id !== "u1")) }, "M33", ["u2"]); // 1 ground factor: cap 3
    expect(capped.numbers!.air).toMatchObject({ factors: 3 });
    expect(capped.numbers!.air!.leftOut).toHaveLength(1);
  });

  it("what the card shows is what the battle uses, over 25 seeds and every choice of attackers", () => {
    const base = committed().state;
    const events = (s: GameState, ids: string[]): GameEvent[] => okOf(applyAction(CTX, s, { type: "ATTACK", side: "axis", units: ids, target: "M33" })).events;
    for (const ids of [["u1"], ["u2"], ["u1", "u2"]]) {
      for (let seed = 1; seed <= 25; seed++) {
        const s = { ...base, rngState: seed };
        const shown = attackPreview(CTX, s, "M33", ids);
        const fought = events(s, ids).find((e) => e.type === "COMBAT_RESOLVED") as Extract<GameEvent, { type: "COMBAT_RESOLVED" }>;
        expect(fought.attackFactors, `${ids.join("+")} seed ${seed}`).toBe(shown.numbers!.attackFactors);
        expect(fought.airFactors ?? 0).toBe(shown.numbers!.air!.factors);
        expect(fought.rounds[0]!.column).toBe(shown.numbers!.column);
        const first = fought.rounds[0]!.result;
        expect(shown.results.some((r) => r.result === first)).toBe(true);
      }
    }
    expect(airOf(base).groundSupport.M33).toEqual(["a1", "a2"]);
  });
});
