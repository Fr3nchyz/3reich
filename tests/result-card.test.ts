import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { combatOf } from "../src/engine/combat-record";
import type { Unit } from "../src/engine/types";
import { openAttack, confirmAttack, normaliseAttack } from "../src/ui/attackTap";
import { roundWords, announcement, grouped } from "../src/ui/attackText";
import { attackPreview } from "../src/ui/attackPreview";
import { createSession, type Session } from "../src/ui/session";
import { normaliseMode, takeAction } from "../src/ui/sessionActions";
import { resultCardHtml } from "../src/ui/resultView";
import { attackHtml } from "../src/ui/attackView";
import { choiceHtml } from "../src/ui/choiceView";
import { GER, POL, at7h } from "./preview-helpers";
import { CTX } from "./helpers";

/** Spec 07 ticket 07-6, State 3: the result card from the events the session logged (Ref 12.1, 12.2). */

function session(units: Unit[], seed: number): Session {
  const s = createSession(SCENARIO_1939, "axis", seed);
  s.state = at7h(units, seed);
  s.log = [];
  return s;
}
const plain = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const text = (s: Session) => resultCardHtml(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/** Attacks Poznan (M33) from M32 with 3 + 3 against one Polish 1 (doubled to 2): 3-1; finds a seed where `want` happens. */
function find(want: (s: Session) => boolean, units: Unit[] = [GER("g1", "M32", 3), GER("g2", "M32", 3), POL("p1", "M33", 1)]): Session {
  for (let seed = 1; seed < 400; seed++) {
    const s = session(units, seed);
    openAttack(s, "M33");
    confirmAttack(s);
    if (want(s)) return s;
  }
  throw new Error("no seed found");
}

describe("the result card", () => {
  it("a win: the column, the roll, the defenders eliminated by name, nothing lost, and the advance offered", () => {
    const s = find((x) => x.battle?.outcome === "defender-eliminated");
    const t = text(s);
    expect(t).toContain("Result: Poznan (M33)");
    expect(t).toMatch(/Column 3-1: 6 against 2\./);
    expect(t).toMatch(/Your attack, column 3-1, roll \d: the defenders are eliminated\./);
    expect(t).toContain("They lost: 1 Polish infantry.");
    expect(t).toContain("You lost nothing.");
    expect(t).toContain("Poznan (M33) is empty. Your surviving units can advance into it");
    expect(combatOf(s.state).advances).toHaveLength(1);
    expect(t).not.toMatch(/\bu\d+\b|\bg\d\b|\bp\d\b/);
  });

  it("an Exchange the player must settle: the card says so, and after the choice names what was lost", () => {
    const s = find((x) => combatOf(x.state).pending !== null);
    expect(text(s)).toContain("The Exchange takes at least 2 factors of yours: you choose which units go.");
    expect(plain(choiceHtml(s, legalActions(s.ctx, s.state)))).toContain("Choose your losses");
    expect(text(s)).not.toContain("You lost nothing.");
    const ways = legalActions(s.ctx, s.state).filter((a) => a.type === "ALLOCATE_LOSSES");
    expect(ways.length).toBeGreaterThan(1);
    takeAction(s, ways[0]!);
    expect(s.battle!.lostAttackers).toHaveLength(1);
    expect(text(s)).toContain("You lost: 3 German infantry.");
    expect(text(s)).toContain("They lost: 1 Polish infantry.");
    expect(text(s)).not.toContain("Choose your losses");
  });

  it("an Exchange the computer settles: the card stays with no list, and the losses are added when they happen", () => {
    const pol = [POL("p1", "M33", 1), POL("p2", "M33", 1), POL("p3", "M33", 1), POL("p4", "M33", 1)];
    const s = find((x) => combatOf(x.state).pending?.chooser === "allies", [GER("g1", "M32", 3), GER("g2", "M32", 3), ...pol]);
    const shown = attackHtml(s, legalActions(s.ctx, s.state));
    expect(shown).toContain("The computer is choosing its losses.");
    expect(shown).not.toContain("Attacks you can make");
    expect(text(s)).toContain("You lost: 2 x 3 German infantry.");
    takeAction(s, legalActions(s.ctx, s.state).find((a) => a.type === "ALLOCATE_LOSSES")!);
    expect(text(s)).toContain("They lost: 3 x 1 Polish infantry.");
    expect(text(s)).not.toContain("computer is choosing");
  });

  it("attackers eliminated: you lose all, they lose nothing", () => {
    const s = find((x) => x.battle?.outcome === "attacker-eliminated", [GER("g1", "M32", 2), POL("p1", "M33", 3)]);
    expect(text(s)).toContain("You lost: 2 German infantry.");
    expect(text(s)).toContain("They lost nothing.");
  });

  it("a counterattack is told round by round, in the board game's words", () => {
    const s = find((x) => (x.battle?.rounds.length ?? 0) > 1);
    const t = text(s);
    expect(t).toMatch(/Your attack, column 3-1, roll \d: Counterattack\./);
    expect(t).toMatch(/Their counterattack, column [^,]+, roll \d: /);
  });

  it("the sweep of a hex with only air units: no roll, destroyed by name", () => {
    const s = session([GER("g1", "M34", 3), POL("a1", "M35", 1, "air"), POL("a2", "M35", 2, "air")], 3);
    openAttack(s, "M35");
    confirmAttack(s);
    const t = text(s);
    expect(s.battle).toMatchObject({ sweep: true });
    expect(t).toContain("No roll. Destroyed: 1 Polish air, 2 Polish air.");
    expect(t).toContain("Warsaw (M35) is empty");
  });

  it("goes with its Player Turn and step, can be closed, and is replaced by the next attack", () => {
    const s = find((x) => x.battle?.outcome === "defender-eliminated", [GER("g1", "M32", 3), GER("g2", "M32", 3), POL("p1", "M33", 1), POL("p2", "N34", 1), GER("g3", "N35", 3)]);
    expect(s.battle?.fresh).toBe(true);
    expect(openAttack(s, "N34")).toBe(true);
    expect(s.battle).toBeNull();
    s.attack = null;
    const t = find((x) => x.battle !== null);
    takeAction(t, { type: "END_STEP", side: "axis", step: "7h" });
    normaliseMode(t);
    expect(t.battle).toBeNull();
    normaliseAttack(t);
  });

  it("the other side's battles make no card (the log has them)", () => {
    const s = session([GER("g1", "M32", 3), POL("p1", "M33", 1)], 1);
    s.humanSide = "allies";
    s.state = { ...s.state, activeSide: "axis" };
    s.battle = null;
    takeAction(s, { type: "ATTACK", side: "axis", units: ["g1"], target: "M33" });
    expect(s.battle).toBeNull();
  });
});

describe("the words", () => {
  it("rounds in the board game's words; a counterattack round reads the other way round", () => {
    expect(roundWords({ by: "attacker", column: "1-1", roll: 5, result: "A" })).toBe("Your attack, column 1-1, roll 5: your attackers are eliminated.");
    expect(roundWords({ by: "defender", column: "1-2", roll: 5, result: "A" })).toBe("Their counterattack, column 1-2, roll 5: the defenders are eliminated.");
    expect(roundWords({ by: "defender", column: "1-2", roll: 6, result: "D" })).toContain("your attackers are eliminated");
    expect(roundWords({ by: "attacker", column: null, roll: null, result: "auto-eliminated" })).toContain("no roll");
  });
  it("counted names, and the one sentence for the screen reader", () => {
    expect(grouped(["1-3 Polish infantry", "1-3 Polish infantry", "1 Polish air"])).toBe("2 x 1-3 Polish infantry, 1 Polish air");
    const s = session([GER("g1", "M32", 3), POL("p1", "M33", 1)], 1);
    expect(announcement(attackPreview(CTX, s.state, "M33", ["g1"]))).toBe("Odds 1-1: 3 against 2.");
    expect(announcement(attackPreview(CTX, s.state, "M33", []))).toBe("Choose at least one unit to attack with");
  });
});
