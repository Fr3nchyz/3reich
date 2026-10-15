import { describe, expect, it } from "vitest";
import { combatOf } from "../src/engine/combat-record";
import { exchangeCost } from "../src/engine/attack-losses";
import { FORCED_COUNTERATTACK_COLUMN, OFFENSIVE_CRT, oddsColumn, type ODDS_COLUMNS } from "../src/engine/combat";
import type { GameState, Unit } from "../src/engine/types";
import { attackPreview, defaultAttackers, type AttackPreview } from "../src/ui/attackPreview";
import { CTX } from "./helpers";
import { GER, POL, at7h, spent, unit } from "./preview-helpers";

/**
 * Spec 07 ticket 07-4: the attack preview model (Ref 12.1, 12.2, 4.5, 4.51). Positions are on the real map:
 * M32 plain next to M33; K35-K34 a river hexside; Q33-Q34 mountains; M36-M37 swamp; Warsaw M35 has neighbours M34, M36, L35, L36, N34, N35.
 */

const preview = (s: GameState, target: string, chosen: string[]): AttackPreview => attackPreview(CTX, s, target, chosen);
const expand = (p: AttackPreview) => p.results.flatMap((r) => r.rolls.map((roll) => [roll, r.result] as const)).sort((a, b) => a[0] - b[0]);

describe("the six results (Ref 12.1)", () => {
  // One German attacker of strength a against Polish infantry of strength d on plain (x2): the column follows from a against 2d.
  const setups: [string, number, number][] = [["1-4", 2, 4], ["1-3", 2, 3], ["1-2", 2, 2], ["1-1", 2, 1], ["2-1", 4, 1], ["3-1", 6, 1], ["4-1", 8, 1], ["5-1", 10, 1]];
  for (const [column, a, d] of setups) {
    it(`column ${column}: the six rows equal OFFENSIVE_CRT, merged by result`, () => {
      const s = at7h([GER("g1", "M32", a), POL("p1", "M33", d)]);
      const p = preview(s, "M33", ["g1"]);
      expect(p.numbers?.column).toBe(column);
      expect(expand(p)).toEqual(OFFENSIVE_CRT[column as (typeof ODDS_COLUMNS)[number]].map((r, i) => [i + 1, r]));
      expect(new Set(p.results.map((r) => r.result)).size).toBe(p.results.length);
      expect(p.results.map((r) => r.rolls[0])).toEqual([...p.results.map((r) => r.rolls[0])].sort());
    });
  }

  it("rolls with the same result share a row and are spelled out in words", () => {
    const p = preview(at7h([GER("g1", "M32", 2), POL("p1", "M33", 1)]), "M33", ["g1"]); // 1-1: Ex CA CA Ex A D
    expect(p.results.map((r) => [r.rollText, r.result])).toEqual([["1 or 4", "Ex"], ["2 or 3", "CA"], ["5", "A"], ["6", "D"]]);
  });

  it("weaker than 1-4: no rows, the attackers are eliminated with no roll, and the button is risky", () => {
    const p = preview(at7h([GER("g1", "M32", 1), POL("p1", "M33", 4)]), "M33", ["g1"]);
    expect(p.numbers).toMatchObject({ column: null, attackFactors: 1, defenseTotal: 8 });
    expect(p.numbers!.oddsText).toContain("eliminated with no roll");
    expect(p.results).toEqual([]);
    expect(p.button).toMatchObject({ risky: true, disabled: false });
  });

  // Follow-up 1 of the review of 07-4: "(1 factors)" and a certain loss is not called "risky".
  it("the button says '1 factor', and a no-roll attack is a certain loss, not a risk", () => {
    const p = preview(at7h([GER("g1", "M32", 1), POL("p1", "M33", 4)]), "M33", ["g1"]);
    expect(p.button.text).toBe("Attack Poznan (M33) with 1 unit (1 factor): no roll, your attackers are eliminated (certain loss)");
    expect(p.button.text).not.toContain("risky");
    expect(p.button.risky).toBe(true); // still amber: the player is warned
    expect(preview(at7h([GER("g1", "M32", 2), POL("p1", "M33", 3)]), "M33", ["g1"]).button.text).toBe("Attack Poznan (M33) with 1 unit (2 factors) at 1-3 (risky)");
  });
});

describe("odds rounding (Ref 12.1)", () => {
  const odds = (a: number, d: number) => preview(at7h([GER("g1", "M32", a), POL("p1", "M33", d)]), "M33", ["g1"]).numbers!;
  it("5 against 12 is 1-3: a weaker attack rounds in the defender's favour", () => {
    expect(odds(5, 6)).toMatchObject({ column: "1-3", defenseTotal: 12 });
    expect(odds(5, 6).oddsText).toContain("rounded against the attacker");
  });
  it("7 against 6 is 1-1, and more than 5-1 counts as 5-1", () => {
    expect(odds(7, 3)).toMatchObject({ column: "1-1", defenseTotal: 6 });
    expect(odds(30, 1)).toMatchObject({ column: "5-1" });
    expect(odds(30, 1).oddsText).toContain("More than 5-1 counts as 5-1");
  });
  it("always agrees with oddsColumn for the shown totals", () => {
    for (let a = 1; a <= 20; a++) for (let d = 1; d <= 6; d++) expect(odds(a, d).column).toBe(oddsColumn(a, d * 2));
  });
});

describe("why the defence is multiplied (Ref 4.5, 4.51)", () => {
  const reason = (units: Unit[], chosen: string[], target: string, extra: Partial<GameState> = {}) => preview(at7h(units, 1, extra), target, chosen).numbers!;
  it("plain country doubles", () => expect(reason([GER("g1", "M32"), POL("p1", "M33")], ["g1"], "M33")).toMatchObject({ multiplier: 2, basis: "plain", multiplierReason: "plain country: doubled" }));
  it("mountains triple", () => expect(reason([GER("g1", "Q33"), POL("p1", "Q34")], ["g1"], "Q34")).toMatchObject({ multiplier: 3, basis: "mountains", multiplierReason: "mountains: tripled" }));
  it("swamp triples", () => expect(reason([GER("g1", "M36"), POL("p1", "M37")], ["g1"], "M37")).toMatchObject({ multiplier: 3, basis: "swamp" }));
  it("a fortress quadruples, and does not add to the mountains", () => {
    expect(reason([GER("g1", "M32"), POL("p1", "M33")], ["g1"], "M33", { fortresses: { M33: true } })).toMatchObject({ multiplier: 4, basis: "fortress", multiplierReason: "fortress: quadrupled" });
    expect(reason([GER("g1", "Q33"), POL("p1", "Q34")], ["g1"], "Q34", { fortresses: { Q34: true } })).toMatchObject({ multiplier: 4, basis: "fortress" });
  });
  it("a river triples only when every chosen attacker is across it, and the card says so when a unit changes that", () => {
    const units = [GER("g1", "K35", 3), GER("g2", "L33", 3), POL("p1", "K34", 2)];
    const s = at7h(units);
    const both = preview(s, "K34", ["g1", "g2"]);
    expect(both.numbers).toMatchObject({ multiplier: 2, basis: "plain" });
    expect(both.riverWarnings).toHaveLength(1);
    expect(both.riverWarnings[0]).toMatch(/^Taking 3 German infantry from .* out of the attack gives the defenders the river bonus: doubled becomes tripled\.$/);
    const alone = preview(s, "K34", ["g1"]);
    expect(alone.numbers).toMatchObject({ multiplier: 3, basis: "river-or-arrow" });
    expect(alone.numbers!.multiplierReason).toContain("every attacker is across it");
    expect(alone.riverWarnings).toHaveLength(1);
    expect(alone.riverWarnings[0]).toMatch(/^Adding 3 German infantry from .* cancels the river bonus: the defence goes from tripled to doubled\.$/);
  });
  it("says nothing about rivers where no unit changes the multiplier", () => {
    expect(preview(at7h([GER("g1", "M32"), GER("g2", "N32"), POL("p1", "M33")]), "M33", ["g1", "g2"]).riverWarnings).toEqual([]);
    expect(preview(at7h([GER("g1", "Q33"), GER("g2", "Q33"), POL("p1", "Q34")]), "Q34", ["g1", "g2"]).riverWarnings).toEqual([]);
  });
});

describe("the cost of an Exchange, in both directions (Ref 12.2)", () => {
  const exchangeRow = (p: AttackPreview) => p.results.find((r) => r.result === "Ex")!;
  it("attackers smaller than the multiplied defence: they lose all, the defenders remove at least that many factors", () => {
    const s = at7h([GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2), POL("p2", "M33", 2)]);
    const row = exchangeRow(preview(s, "M33", ["g1", "g2"]));
    expect(row.exchange).toEqual(exchangeCost([s.units.g1!, s.units.g2!], [s.units.p1!, s.units.p2!], 2));
    expect(row.exchange).toMatchObject({ attackersLoseAll: true, chooser: "defenders", required: 4 });
    expect(row.text).toBe("Exchange: you lose all 4 of your factors; they lose at least 4 factors, each of their units counting doubled and they choose which units.");
  });
  it("attackers larger: the defenders lose all, the attackers remove at least the multiplied defence", () => {
    const s = at7h([GER("g1", "M32", 3), GER("g2", "M32", 2), POL("p1", "M33"), POL("p2", "M33")]);
    const row = exchangeRow(preview(s, "M33", ["g1", "g2"]));
    expect(row.exchange).toMatchObject({ defendersLoseAll: true, chooser: "attackers", required: 4 });
    expect(row.text).toBe("Exchange: they lose all (their 4 counted doubled); you lose at least 4 of your factors (only one set of your units is enough, so nothing is left to choose). The hex is left empty and your survivors may advance.");
  });
  it("equal totals: both lose everything", () => {
    const s = at7h([GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2)]);
    const row = exchangeRow(preview(s, "M33", ["g1", "g2"]));
    expect(row.exchange).toMatchObject({ chooser: null });
    expect(row.text).toBe("Exchange: the sides are equal at 4 factors, so both lose every unit.");
  });
});

describe("Counterattack, CA1, CA2, CA3 (Ref 12.2)", () => {
  const counterOf = (a: number, d: number, result: string) => preview(at7h([GER("g1", "M32", a), POL("p1", "M33", d)]), "M33", ["g1"]).results.find((r) => r.result === result)!.counter!;
  it("a plain CA is rolled on the defenders' basic factors against the attackers'", () => {
    const c = counterOf(2, 1, "CA"); // 1-1: the defender's 1 against 2
    expect(c.column).toBe(oddsColumn(1, 2));
    expect(OFFENSIVE_CRT["1-2"]).toEqual(["Ex", "Ex", "CA", "A", "A", "A"]);
    expect(c.lines.map((l) => [l.rollText, l.result])).toEqual([["1 or 2", "Ex"], ["3", "CA"], ["4, 5 or 6", "A"]]);
  });
  for (const [result, a, d] of [["CA1", 4, 1], ["CA2", 4, 1], ["CA3", 6, 1]] as const) {
    it(`${result} forces column ${FORCED_COUNTERATTACK_COLUMN[result]}`, () => {
      const c = counterOf(a, d, result);
      expect(c.column).toBe(FORCED_COUNTERATTACK_COLUMN[result]);
      expect(c.text).toContain(`fixed column ${FORCED_COUNTERATTACK_COLUMN[result]}`);
    });
  }
  it("what a counterattack roll does: A eliminates the defenders, D the attackers, another CA repeats the attack", () => {
    const lines = counterOf(4, 1, "CA1").lines; // column 1-1: Ex CA CA Ex A D
    const text = (r: string) => lines.find((l) => l.result === r)!.text;
    expect(text("A")).toBe("The defenders are eliminated.");
    expect(text("D")).toBe("Your attackers are eliminated.");
    expect(text("CA")).toBe("Your attack is made again at the same odds.");
    expect(text("Ex")).toContain("Basic factors on both sides");
  });
});

describe("a hex with no ground defender: the sweep (ALONE_NONGROUND_DESTROYED, TODO(verify))", () => {
  // Warsaw after the infantry are gone: two Polish air units.
  const air = [POL("a1", "M35", 1, "air"), POL("a2", "M35", 2, "air")];
  it("says no roll, names the counters, and has no numbers or rows", () => {
    const s = at7h([GER("g1", "M34", 3), GER("g2", "N34", 2), ...air]);
    const p = preview(s, "M35", defaultAttackers(CTX, s, "M35"));
    expect(p.sweep?.text).toMatch(/^No roll\. These 2 counters are destroyed: /);
    expect(p.sweep?.destroyed).toHaveLength(2);
    expect(p.numbers).toBeNull();
    expect(p.results).toEqual([]);
    expect(p.defenders).toEqual([]);
    expect(p.button).toEqual({ text: expect.stringMatching(/^Destroy .*Polish air.* in Warsaw \(M35\)$/), risky: false, disabled: false });
  });
  it("defaults to the weakest single unit, infantry first", () => {
    const s = at7h([GER("g1", "M34", 3), GER("g2", "N34", 2), GER("g3", "L35", 1, "armor"), ...air]);
    expect(defaultAttackers(CTX, s, "M35")).toEqual(["g2"]); // infantry 2 beats armor 1: infantry first
    const noInfantry = at7h([GER("g1", "M34", 3, "armor"), GER("g3", "L35", 1, "armor"), ...air]);
    expect(defaultAttackers(CTX, noInfantry, "M35")).toEqual(["g3"]);
  });
  it("more units may be added with no effect on the result", () => {
    const s = at7h([GER("g1", "M34", 3), GER("g2", "N34", 2), ...air]);
    const p = preview(s, "M35", ["g1", "g2"]);
    expect(p.sweep?.destroyed).toHaveLength(2);
    expect(p.attackers.map((c) => c.state)).toEqual(["chosen", "chosen"]);
  });
  it("a hex with ground defenders is no sweep, and the air units are listed as not defending", () => {
    const s = at7h([GER("g1", "M34", 3), POL("p1", "M35", 1), ...air]);
    const p = preview(s, "M35", defaultAttackers(CTX, s, "M35"));
    expect(p.sweep).toBeNull();
    expect(p.defenders).toHaveLength(1);
    expect(p.nonDefenders.map((n) => n.reason)).toEqual(["does not defend", "does not defend"]);
    expect(p.alsoDestroyed).toHaveLength(2);
    expect(p.results.find((r) => r.result === "D")!.text).toContain("go too");
  });
});

describe("candidates and why one is greyed (spec 07 part A)", () => {
  it("lists every ground unit next to the hex; one that has attacked is greyed with its reason and does not count", () => {
    const s = spent(at7h([GER("g1", "M32", 3), GER("g2", "N32", 2), POL("p1", "M33")]), ["g2"]);
    const p = preview(s, "M33", ["g1", "g2"]);
    expect(p.attackers.map((c) => [c.state, c.reason])).toEqual([["chosen", null], ["greyed", "has already attacked this turn"]]);
    expect(p.numbers?.attackFactors).toBe(3);
    expect(p.problems).toEqual(["The 2 German infantry counter has already attacked this turn."]);
    expect(p.button.disabled).toBe(true);
  });
  it("a unit across a coast is greyed: ground units may not attack over that hexside", () => {
    const s = at7h([GER("g1", "J36"), GER("g2", "J34"), POL("p1", "J35")]);
    const p = preview(s, "J35", []);
    const g1 = p.attackers.find((c) => c.id === "g1")!;
    expect(g1).toMatchObject({ state: "greyed", reason: "cannot attack across the hexside between the two hexes" });
  });
  it("units that are not ground units, or not next to the hex, are not candidates", () => {
    const s = at7h([GER("a1", "M32", 4, "air"), GER("far", "A5"), POL("p1", "M33")]);
    expect(preview(s, "M33", []).attackers).toEqual([]);
    expect(preview(s, "M33", []).problems).toEqual(["None of your units that have not attacked is next to this hex."]);
  });
  it("a unit that is at war with nobody in the hex is greyed (it is not in the listing of legalActions either)", () => {
    // Allies move: Polish infantry (at war with Germany) and British infantry (here Britain has not declared war on Germany) both stand next to a German hex.
    const base = at7h([unit("po", "poland", "infantry", 2, "M32"), unit("br", "britain", "infantry", 3, "N32"), GER("g1", "M33")], 1, { activeSide: "allies" });
    const s = { ...base, wars: base.wars.filter((w) => !w.includes("britain")) };
    const p = preview(s, "M33", ["po", "br"]);
    expect(p.attackers.map((c) => [c.state, c.reason])).toEqual([["chosen", null], ["greyed", "is not at war with anyone in this hex"]]);
  });
  it("identical counters in one hex are told apart", () => {
    const p = preview(at7h([GER("g1", "M32"), GER("g2", "M32"), GER("g3", "N32"), POL("p1", "M33")]), "M33", ["g1"]);
    expect(p.attackers.map((c) => c.nth)).toEqual(["1 of 2", "2 of 2", null]);
  });
});

describe("problems and the button", () => {
  it("no unit chosen: a problem, the numbers wait, the button is disabled and says what to do", () => {
    const p = preview(at7h([GER("g1", "M32"), POL("p1", "M33")]), "M33", []);
    expect(p.problems).toEqual(["No unit is chosen to attack."]);
    expect(p.numbers).toBeNull();
    expect(p.defenders).toHaveLength(1); // the defenders are shown as seen by everyone who could attack
    expect(p.button).toEqual({ text: "Choose at least one unit to attack with", risky: false, disabled: true });
  });
  it("only at step 7h", () => {
    const s = { ...at7h([GER("g1", "M32"), POL("p1", "M33")]), position: { part: "player-turn" as const, turn: 1 as const, step: "6f" } };
    expect(preview(s, "M33", ["g1"]).problems).toEqual(["Attacks are made at step 7h."]);
  });
  it("a hex attacked once already is refused with the right words", () => {
    const s = spent(at7h([GER("g1", "M32"), POL("p1", "M33")]), [], ["M33"]);
    const p = preview(s, "M33", ["g1"]);
    expect(p.problems).toEqual(["This hex has already been attacked this turn."]);
    expect(p.button.disabled).toBe(true);
  });
  it("an Exchange waiting for its losses comes first", () => {
    const s = at7h([GER("g1", "M32"), POL("p1", "M33")]);
    const t = { ...s, combat: { ...combatOf(s), pending: { chooser: "axis" as const, target: "M33", candidates: ["g1"], values: { g1: 1 }, required: 1, attackers: ["g1"] } } };
    expect(preview(t, "M33", ["g1"]).problems).toEqual(["An Exchange is waiting for its losses to be chosen first."]);
  });
  it("a hex of a power you are not at war with", () => {
    const s = at7h([GER("g1", "M32"), unit("it", "italy", "infantry", 3, "M33")]);
    expect(preview(s, "M33", ["g1"]).problems).toEqual(["You are not at war with Italy."]);
  });
  it("the one-try line, and the amber flag for odds worse than 1-1 only (no pop-up: one button)", () => {
    const risky = (a: number, d: number) => preview(at7h([GER("g1", "M32", a), POL("p1", "M33", d)]), "M33", ["g1"]).button;
    expect(preview(at7h([GER("g1", "M32"), POL("p1", "M33")]), "M33", ["g1"]).oneTry).toBe("One try: this hex cannot be attacked again this turn.");
    for (const [a, d] of [[2, 1], [4, 1], [10, 1]] as const) expect(risky(a, d).risky, `${a} against ${d * 2}`).toBe(false);
    for (const [a, d] of [[2, 2], [2, 3], [2, 4], [1, 4]] as const) expect(risky(a, d).risky, `${a} against ${d * 2}`).toBe(true);
    expect(risky(2, 3).text).toBe("Attack Poznan (M33) with 1 unit (2 factors) at 1-3 (risky)");
    expect(risky(2, 1).text).toBe("Attack Poznan (M33) with 1 unit (2 factors)");
  });
});

describe("wording fixes from the review of 07-4", () => {
  it("chosen units that have attacked: agreement for one counter and for several", () => {
    const s = spent(at7h([GER("g1", "M32", 3), GER("g2", "N32", 2), GER("g3", "N32", 2), POL("p1", "M33")]), ["g2", "g3"]);
    expect(preview(s, "M33", ["g1", "g2"]).problems).toEqual(["The 2 German infantry counter has already attacked this turn."]);
    expect(preview(s, "M33", ["g1", "g2", "g3"]).problems).toEqual(["2 x 2 German infantry counters have already attacked this turn."]);
  });

  it("every unit greyed: the button says the real reason, not 'choose a unit'", () => {
    const s = spent(at7h([GER("g1", "M32", 3), GER("g2", "N32", 2), POL("p1", "M33")]), ["g1", "g2"]);
    const p = preview(s, "M33", []);
    expect(p.problems).toEqual(["Nothing can attack Poznan (M33) now: the 2 units next to it have already attacked this turn."]);
    expect(p.button).toEqual({ text: p.problems[0], risky: false, disabled: true });
  });

  it("enemy air units protected by a third-party ground unit: greyed with that reason, and the button says it", () => {
    // Italian infantry (not at war with Germany) stands with Polish air units: the air units are not alone, so they cannot be swept.
    const s = at7h([GER("g1", "M32"), unit("it", "italy", "infantry", 3, "M33"), POL("a1", "M33", 1, "air")]);
    const p = preview(s, "M33", []);
    expect(p.attackers[0]).toMatchObject({ state: "greyed", reason: expect.stringContaining("protected by a Italian ground unit") });
    expect(p.button.text).toContain("Nothing can attack Poznan (M33) now");
    expect(p.button.text).toContain("protected by");
    expect(p.button.text).not.toContain("Choose at least one unit");
  });

  it("the Exchange row mentions the air units and fleets swept when the defenders go, and the advance", () => {
    const air = [POL("a1", "M35", 1, "air"), POL("a2", "M35", 1, "air")];
    const s = at7h([GER("g1", "M34", 3), GER("g2", "N34", 3), POL("p1", "M35"), ...air]);
    const row = preview(s, "M35", ["g1", "g2"]).results.find((r) => r.result === "Ex")!;
    expect(row.exchange).toMatchObject({ defendersLoseAll: true, chooser: "attackers" });
    expect(row.text).toContain("These enemy counters in the hex go too, with no roll: 1 Polish air, 1 Polish air");
    expect(row.text).toContain("your survivors may advance");
    // The D row says the same, so the two rows agree about what is left.
    expect(preview(s, "M35", ["g1", "g2"]).results.find((r) => r.result === "D")!.text).toContain("1 Polish air, 1 Polish air");
  });

  it("'you choose' only when there is a real choice of units", () => {
    const one = preview(at7h([GER("g1", "M32", 4), POL("p1", "M33")]), "M33", ["g1"]).results.find((r) => r.result === "Ex")!;
    expect(one.exchange).toMatchObject({ chooser: "attackers", required: 2 });
    expect(one.text).toContain("nothing is left to choose");
    expect(one.text).not.toContain("you choose");
    const two = preview(at7h([GER("g1", "M32", 4), GER("g2", "M32", 4), POL("p1", "M33")]), "M33", ["g1", "g2"]).results.find((r) => r.result === "Ex")!;
    expect(two.text).toContain("you choose which units");
    const theirs = preview(at7h([GER("g1", "M32", 2), POL("p1", "M33", 2)]), "M33", ["g1"]); // 2 against 4: they lose at least 2 of 2 (1 unit)
    expect(theirs.results.find((r) => r.result === "Ex")!.text).toContain("nothing is left to choose");
  });

  it("a hex left empty by a win says the survivors may advance (emptyAfterWin); with a third-party unit staying it does not", () => {
    const plain = preview(at7h([GER("g1", "M32", 4), POL("p1", "M33")]), "M33", ["g1"]).results.find((r) => r.result === "D")!;
    expect(plain.text).toContain("The hex is left empty and your survivors may advance.");
    const guarded = preview(at7h([GER("g1", "M32", 4), POL("p1", "M33"), unit("it", "italy", "infantry", 3, "M33")]), "M33", ["g1"]).results.find((r) => r.result === "D")!;
    expect(guarded.text).not.toContain("may advance");
  });
});
