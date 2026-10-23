import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { createSession, run, type Session } from "../src/ui/session";
import { statusHtml } from "../src/ui/statusView";
import { CTX, atStart, atStartOffensive } from "./helpers";

/** The Attack, Lose and Advance buttons and the battle log lines name places and counters; no unit id ("u94") is left (spec 07, part B). */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, movement: number | undefined, at: string): Unit => ({
  id,
  owner,
  type,
  strength,
  at,
  ...(movement === undefined ? {} : { movement }),
});
const at7h = (units: Unit[], seed = 1): GameState => ({
  ...atStartOffensive(SCENARIO_1939, 1),
  activeSide: "axis",
  position: { part: "player-turn", turn: 1, step: "7h" },
  units: Object.fromEntries(units.map((u) => [u.id, u])),
  rngState: seed,
});
const sessionAt = (state: GameState): Session => {
  const s = createSession(SCENARIO_1939, "axis", 1);
  s.state = state;
  s.log = [];
  return s;
};
const buttons = (s: Session): string[] => [...statusHtml(s, null, legalActions(s.ctx, s.state)).matchAll(/<button data-action="\d+">(.*?)<\/button>/g)].map((m) => m[1]!);
const NO_ID = /\bu\d+\b/;

/** The Polish defence of Warsaw (M35) and two German stacks next to it: the armor in Lodz-side hexes M34 (no printed name). */
const poles = (): Unit[] => [unit("u12", "poland", "infantry", 1, 3, "M35"), unit("u13", "poland", "infantry", 1, 3, "M35")];

describe("the Attack button", () => {
  it("names the target with its coordinate in brackets and the attackers by kind, nation and place, with no unit id", () => {
    const s = sessionAt(at7h([unit("u94", "germany", "armor", 3, 4, "M34"), unit("u95", "germany", "infantry", 2, 3, "M34"), unit("u96", "germany", "infantry", 2, 3, "M34"), ...poles()]));
    const attacks = buttons(s).filter((b) => b.startsWith("Attack"));
    expect(attacks).toContain("Attack Warsaw (M35) with 3-4 German armor, 2 x 2-3 German infantry from M34");
    for (const b of attacks) expect(b).not.toMatch(NO_ID);
  });

  it("tells a stack from a named hex by that name, and tells apart the buttons of two hexes", () => {
    const s = sessionAt(at7h([unit("u94", "germany", "armor", 3, 4, "M33"), unit("u95", "germany", "infantry", 2, 3, "N33"), unit("u30", "poland", "infantry", 1, 3, "M34")]));
    const attacks = buttons(s).filter((b) => b.startsWith("Attack"));
    expect(attacks).toEqual([
      "Attack M34 with 3-4 German armor from Poznan (M33) and 2-3 German infantry from Lodz (N33)",
      "Attack M34 with 3-4 German armor from Poznan (M33)",
      "Attack M34 with 2-3 German infantry from Lodz (N33)",
    ]);
    expect(new Set(attacks).size).toBe(attacks.length);
  });

  it("names the target of a hex held only by air units", () => {
    const s = sessionAt(at7h([unit("u94", "germany", "infantry", 2, 3, "M34"), unit("u50", "poland", "air", 1, 6, "M35")]));
    expect(buttons(s)).toContain("Attack Warsaw (M35) with 2-3 German infantry from M34");
  });
});

/** Plays ATTACK on Warsaw over seeds until `want` holds for the state after it; returns that state. */
function afterAttack(units: Unit[], from: string[], want: (s: GameState) => boolean): GameState {
  for (let seed = 1; seed < 400; seed++) {
    const r = applyAction(CTX, at7h(units, seed), { type: "ATTACK", side: "axis", units: from, target: "M35" });
    if (r.ok && want(r.state)) return r.state;
  }
  throw new Error("no seed found");
}
const has = (s: GameState, type: Action["type"]) => legalActions(CTX, s).some((a) => a.type === type);

describe("the Lose button", () => {
  it("names the counter and where it stands", () => {
    const units = [unit("u94", "germany", "armor", 3, 4, "M34"), unit("u95", "germany", "infantry", 2, 3, "N34"), unit("u12", "poland", "infantry", 2, 3, "M35"), unit("u13", "poland", "infantry", 2, 3, "M35")];
    const state = afterAttack(units, ["u94", "u95"], (s) => has(s, "ALLOCATE_LOSSES"));
    const lose = buttons(sessionAt(state)).filter((b) => b.startsWith("Lose"));
    expect(lose.length).toBeGreaterThan(0);
    for (const b of lose) {
      expect(b).not.toMatch(NO_ID);
      expect(b).toMatch(/^Lose \d+-\d+ (German|Polish) (armor|infantry) from (M34|N34|Warsaw \(M35\))/);
    }
  });
});

describe("the Advance button", () => {
  it("names the units and the place they go into", () => {
    const units = [unit("u94", "germany", "armor", 4, 4, "M34"), unit("u95", "germany", "armor", 4, 4, "M34"), unit("u12", "poland", "infantry", 1, 3, "M35")];
    const state = afterAttack(units, ["u94", "u95"], (s) => has(s, "ADVANCE"));
    const advance = buttons(sessionAt(state)).filter((b) => b.startsWith("Advance"));
    expect(advance.length).toBeGreaterThan(0);
    expect(advance).toContain("Advance 2 x 4-4 German armor from M34 into Warsaw (M35)");
    for (const b of advance) expect(b).not.toMatch(NO_ID);
  });
});

describe("the battle log", () => {
  it("names the place in the line of the attack and carries no unit id in the lines of its aftermath", () => {
    const units = [unit("u94", "germany", "armor", 4, 4, "M34"), unit("u95", "germany", "armor", 4, 4, "M34"), unit("u12", "poland", "infantry", 2, 3, "M35"), unit("u13", "poland", "infantry", 2, 3, "M35")];
    // Walk the whole fight, choosing the first losses and the first advance offered, over several seeds.
    let sawLoss = false;
    let sawAdvance = false;
    for (let seed = 1; seed < 60; seed++) {
      const s = sessionAt(at7h(units, seed));
      expect(run(s, { type: "ATTACK", side: "axis", units: ["u94", "u95"], target: "M35" })).toBe(true);
      for (let guard = 0; guard < 4; guard++) {
        const next = legalActions(s.ctx, s.state).find((a) => a.type === "ALLOCATE_LOSSES" || a.type === "ADVANCE");
        if (!next) break;
        sawLoss ||= next.type === "ALLOCATE_LOSSES";
        sawAdvance ||= next.type === "ADVANCE";
        expect(run(s, next)).toBe(true);
      }
      expect(s.log[0]).toMatch(/^Attack on Warsaw \(M35\): /);
      for (const line of s.log) expect(line, line).not.toMatch(NO_ID);
      expect(s.log.some((l) => l.startsWith("Eliminated: "))).toBe(true);
    }
    expect(sawLoss && sawAdvance).toBe(true);
  });

  it("tells an eliminated counter by its kind and nation, and an advance by name", () => {
    const units = [unit("u94", "germany", "armor", 4, 4, "M34"), unit("u95", "germany", "armor", 4, 4, "M34"), unit("u12", "poland", "infantry", 1, 3, "M35")];
    const state = afterAttack(units, ["u94", "u95"], (s) => has(s, "ADVANCE"));
    const s = sessionAt(state);
    const both = legalActions(s.ctx, s.state).find((a) => a.type === "ADVANCE" && a.units.length === 2)!;
    expect(run(s, both)).toBe(true);
    expect(s.log).toContain("2 x 4-4 German armor advance into Warsaw (M35).");
  });
});
