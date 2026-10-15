import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { combatOf, turnKey } from "../src/engine/combat-record";
import type { GameState, Unit } from "../src/engine/types";
import { advanceModel, advanceOffers, defaultAdvance } from "../src/ui/advanceOptions";
import { onCardKey } from "../src/ui/attackBind";
import { confirmAttack, openAttack } from "../src/ui/attackTap";
import { confirmAdvance, confirmLosses, normaliseChoice, openOffers, pickedAdvance, pickedLosses, pickLossWay, stayOut, toggleAdvance, toggleLoss } from "../src/ui/choiceTap";
import { choiceHtml } from "../src/ui/choiceView";
import { e2eFixtureSession } from "./preview-helpers";
import { MAX_GROUPS, lossModel, ownPending } from "../src/ui/lossOptions";
import { nextText } from "../src/ui/nextBar";
import { createSession, type Session } from "../src/ui/session";
import { attackHtml } from "../src/ui/attackView";
import { statusHtml } from "../src/ui/statusView";
import { resultCardHtml } from "../src/ui/resultView";
import { CTX } from "./helpers";
import { GER, POL, at7h } from "./preview-helpers";

/**
 * Spec 07 ticket 07-7, State 4: the "Choose your losses" and "Advance into <place>?" cards (Ref 12.1, 12.2 for the Exchange, 5.0 for the stacking
 * limit that decides which survivors fit). The models read what the engine offers; these tests check them against it.
 */

const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const acts = (s: Session) => legalActions(s.ctx, s.state);

function withPending(units: Unit[], pending: { candidates: string[]; values: Record<string, number>; required: number }, extra: Partial<GameState> = {}): GameState {
  const base = at7h(units, 1, extra);
  return { ...base, combat: { turn: turnKey(base), attacked: [], targets: [], advances: [], pending: { chooser: "axis", target: "M33", attackers: [], ...pending } } };
}

describe("Choose your losses: the model", () => {
  const units = [GER("a", "M32", 4, "armor"), GER("i1", "M32", 3), GER("i2", "M31", 3), GER("i3", "M31", 3)];
  const values = { a: 4, i1: 3, i2: 3, i3: 3 };

  it("is only for an Exchange the player settles", () => {
    const state = withPending(units, { candidates: ["a", "i1"], values, required: 4 });
    expect(ownPending(state, "axis")).not.toBeNull();
    expect(lossModel(CTX, state, "allies", [], [])).toBeNull(); // the other side chooses: nothing to show
    expect(lossModel(CTX, at7h(units), "axis", [], [])).toBeNull(); // no Exchange waiting
  });

  it("names every unit with its factors and place; no raw id; identical counters in one hex are told apart", () => {
    const state = withPending([GER("a", "M32", 4, "armor"), GER("i1", "M32", 3), GER("i2", "M32", 3)], { candidates: ["a", "i1", "i2"], values: { a: 4, i1: 3, i2: 3 }, required: 4 });
    const m = lossModel(CTX, state, "axis", acts({ ctx: CTX, state } as Session), [])!;
    expect(m.chips.map((c) => c.name)).toEqual(["4 German armor", "3 German infantry", "3 German infantry"]);
    expect(m.chips.map((c) => c.nth)).toEqual([null, "1 of 2", "2 of 2"]);
    expect(m.chips[0]!.from).toBe("M32");
    expect(m.chips.map((c) => `${c.name} ${c.from}`).join(" ")).not.toMatch(/\b(a|i1|i2)\b/);
  });

  it("counts a defender at its terrain multiple and says so", () => {
    const state = withPending([POL("p1", "M33", 1)], { candidates: ["p1"], values: { p1: 2 }, required: 2 }, { activeSide: "axis" });
    const m = lossModel(CTX, state, "axis", [], [])!;
    expect(m.chips[0]!.value).toBe(2);
    expect(m.chips[0]!.countsAs).toBe("counts as 2 factors");
    const plainOne = lossModel(CTX, withPending([GER("a", "M32", 4, "armor")], { candidates: ["a"], values: { a: 4 }, required: 4 }), "axis", [], [])!;
    expect(plainOne.chips[0]!.countsAs).toBeNull();
  });

  it("the running total: short, enough, and more than the Exchange takes (a unit could be spared)", () => {
    const state = withPending(units, { candidates: ["a", "i1", "i2", "i3"], values, required: 4 });
    const legal: Action[] = [{ type: "ALLOCATE_LOSSES", side: "axis", units: ["a"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["i1", "i2"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["i1", "i3"] }, { type: "ALLOCATE_LOSSES", side: "axis", units: ["i2", "i3"] }];
    const at = (chosen: string[]) => lossModel(CTX, state, "axis", legal, chosen)!;
    expect(at([]).total).toBe("Chosen 0 of at least 4 factors: 4 more needed.");
    expect(at(["i1"]).total).toBe("Chosen 3 of at least 4 factors: 1 more needed.");
    expect(at(["i1"]).button).toEqual({ text: "Choose 1 more factor to lose", disabled: true });
    expect(at(["i1", "i2"]).total).toBe("Chosen 6 of at least 4 factors. That is enough.");
    expect(at(["i1", "i2"]).legal).toBe(true);
    expect(at(["i1", "i2"]).button).toEqual({ text: "Lose 2 x 3 German infantry", disabled: false });
    expect(at(["a", "i1"]).total).toBe("Chosen 7 of at least 4 factors: more than the Exchange takes. Take one off.");
    expect(at(["a", "i1"]).button.disabled).toBe(true);
    expect(at(["a"]).legal).toBe(true);
  });

  it("groups the legal sets by what they are: the same kinds from other hexes are one way with several variants, the smallest in units first", () => {
    const state = withPending(units, { candidates: ["a", "i1", "i2", "i3"], values, required: 4 });
    const legal: Action[] = [["i1", "i2"], ["a"], ["i1", "i3"], ["i2", "i3"]].map((u) => ({ type: "ALLOCATE_LOSSES", side: "axis", units: u }));
    const m = lossModel(CTX, state, "axis", legal, [])!;
    expect(m.groups.map((g) => [g.text, g.factors, g.variants])).toEqual([["4 German armor", 4, 1], ["2 x 3 German infantry", 6, 3]]);
    expect(m.groups[0]!.ids).toEqual(["a"]);
    expect(m.groups[1]!.ids).toEqual(["i1", "i2"]); // the first of the three sets
    expect(m.moreGroups).toBe(false);
  });

  it("lists at most MAX_GROUPS ways and says more exist", () => {
    const many = Array.from({ length: 9 }, (_, i) => GER(`k${i}`, "M32", i + 1));
    const values9 = Object.fromEntries(many.map((u) => [u.id, u.strength]));
    const state = withPending(many, { candidates: many.map((u) => u.id), values: values9, required: 1 });
    const legal: Action[] = many.map((u) => ({ type: "ALLOCATE_LOSSES", side: "axis", units: [u.id] }));
    const m = lossModel(CTX, state, "axis", legal, [])!;
    expect(m.groups).toHaveLength(MAX_GROUPS);
    expect(m.moreGroups).toBe(true);
  });
});

describe("Advance into <place>?: the model", () => {
  /** Three Germans beat one Pole at Poznan (M33) from M32: the stacking limit (Ref 5.0) is two ground units a hex. */
  function won(): Session {
    const s = createSession(SCENARIO_1939, "axis", 1);
    for (let seed = 1; seed < 400; seed++) {
      s.state = at7h([GER("g1", "M32", 3), GER("g2", "M32", 3), GER("g3", "M32", 3), POL("p1", "M33", 1)], seed);
      s.log = []; s.battle = null; s.choice = null; s.attack = null;
      openAttack(s, "M33");
      confirmAttack(s);
      if (combatOf(s.state).advances.length > 0 && !combatOf(s.state).pending) return s;
    }
    throw new Error("no seed");
  }

  it("starts with the most units that fit, and offers every survivor as a chip", () => {
    const s = won();
    const survivors = combatOf(s.state).advances[0]!.units.length;
    expect(survivors).toBeGreaterThanOrEqual(2);
    const a = acts(s);
    expect(advanceOffers(a)).toEqual(["M33"]);
    const m = advanceModel(s.ctx, s.state, a, "M33", null)!;
    expect(m.toName).toBe("Poznan (M33)");
    expect(m.chips).toHaveLength(survivors);
    expect(m.chosenCount).toBe(2);
    expect(m.button).toEqual({ text: "Advance 2 units into Poznan (M33)", disabled: false });
    expect(defaultAdvance(s.state, a, "M33")).toHaveLength(2);
    expect(m.chips.map((c) => c.name)).toEqual(Array(survivors).fill("3 German infantry"));
    expect(m.chips[0]!.from).toBe("M32");
  });

  it("a choice that does not fit is refused in words, and none chosen says so", () => {
    const s = won();
    const a = acts(s);
    const survivors = combatOf(s.state).advances[0]!.units;
    if (survivors.length >= 3) {
      expect(advanceModel(s.ctx, s.state, a, "M33", survivors)!.button).toEqual({ text: `These ${survivors.length} units do not all fit in Poznan (M33)`, disabled: true });
    }
    expect(advanceModel(s.ctx, s.state, a, "M33", [])!.button).toEqual({ text: "Choose at least one unit to advance", disabled: true });
    expect(advanceModel(s.ctx, s.state, a, "M33", [survivors[0]!])!.button).toEqual({ text: "Advance 1 unit into Poznan (M33)", disabled: false });
  });

  it("is null for a hex that is not offered", () => {
    const s = won();
    expect(advanceModel(s.ctx, s.state, acts(s), "M35", null)).toBeNull();
  });
});

describe("the whole sequence on the recorded game: attack, Exchange, losses, advance, done", () => {
  /** Seed 27 at Warsaw (M35): column 1-2, a Counterattack, then an Exchange the Axis player settles (armor, or 2 infantry), then the hex is empty. */
  function atLosses(): Session {
    const s = e2eFixtureSession(27);
    openAttack(s, "M35");
    confirmAttack(s);
    return s;
  }

  it("the Exchange waits for the player's losses: one card with ways, chips and a running total", () => {
    const s = atLosses();
    expect(combatOf(s.state).pending).toMatchObject({ chooser: "axis", required: 4 });
    const html = choiceHtml(s, acts(s));
    const text = plain(html);
    expect(text).toContain("Choose your losses");
    expect(text).toContain("at least 4 factors");
    expect(text).toContain("Lose 4-6 German armor");
    expect(text).toContain("Lose 2 x 3-3 German infantry");
    expect(text).toContain("Chosen 0 of at least 4 factors: 4 more needed.");
    expect(text).not.toMatch(/\bu\d+\b/);
    expect(html).toContain("disabled"); // nothing chosen: the confirm button is off
    expect(nextText(s, acts(s))).toBe("Next: choose your losses.");
    expect(acts(s).every((a) => a.type === "ALLOCATE_LOSSES")).toBe(true); // the engine offers nothing else, not even Done
  });

  it("chips toggle; a quick pick chooses a whole way; Confirm makes exactly the ALLOCATE_LOSSES the engine lists", () => {
    const s = atLosses();
    const a = acts(s);
    const armor = a.find((x) => x.type === "ALLOCATE_LOSSES" && x.units.length === 1)!;
    const id = armor.type === "ALLOCATE_LOSSES" ? armor.units[0]! : "";
    toggleLoss(s, id);
    expect(pickedLosses(s)).toEqual([id]);
    toggleLoss(s, id);
    expect(pickedLosses(s)).toEqual([]);
    toggleLoss(s, "no-such-unit");
    expect(pickedLosses(s)).toEqual([]);
    confirmLosses(s); // nothing chosen: refused with words, nothing happens
    expect(s.toast).toBe("Choose 4 more factors to lose");
    expect(combatOf(s.state).pending).not.toBeNull();
    pickLossWay(s, 0);
    expect(pickedLosses(s)).toEqual([id]);
    const before = s.state;
    const expected = applyAction(s.ctx, before, armor);
    confirmLosses(s);
    expect(expected.ok && s.state).toEqual(expected.ok ? expected.state : null);
    expect(s.battle!.lostAttackers.map((u) => u.type)).toEqual(["armor"]);
  });

  it("after the losses the advance card comes up; Advance moves the chosen survivors; the result says so; Done ends the step", () => {
    const s = atLosses();
    pickLossWay(s, 0); // armor goes: the two infantry survive
    confirmLosses(s);
    expect(combatOf(s.state).pending).toBeNull();
    expect(s.choice).toBeNull();
    const a = acts(s);
    expect(advanceOffers(a)).toEqual(["M35"]);
    expect(nextText(s, a)).toBe("Next: advance into Warsaw (M35), or stay.");
    const text = plain(choiceHtml(s, a));
    expect(text).toContain("Advance into Warsaw (M35)?");
    expect(text).toContain("Advance 2 units into Warsaw (M35)");
    expect(text).toContain("Stay");
    toggleAdvance(s, "M35", pickedAdvance(s, "M35", a)[0]!);
    expect(pickedAdvance(s, "M35", a)).toHaveLength(1);
    expect(plain(choiceHtml(s, a))).toContain("Advance 1 unit into Warsaw (M35)");
    toggleAdvance(s, "M35", "no-such-unit");
    expect(pickedAdvance(s, "M35", a)).toHaveLength(1);
    confirmAdvance(s, "M35");
    expect(combatOf(s.state).advances).toEqual([]);
    expect(s.battle!.advanced).toHaveLength(1);
    expect(plain(resultCardHtml(s))).toContain("You advanced 3-3 German infantry into it.");
    expect(s.log.some((l) => /^3-3 German infantry advance into Warsaw \(M35\)\./.test(l))).toBe(true);
    expect(choiceHtml(s, acts(s))).toBe("");
    expect(nextText(s, acts(s))).toBe("Next: attack a red hex, or finish.");
    const done = acts(s).find((x) => x.type === "END_STEP")!;
    expect(applyAction(s.ctx, s.state, done).ok).toBe(true);
  });

  it("Stay puts the card away without any action: the engine's offer is untouched, and the result card says the units stayed", () => {
    const s = atLosses();
    pickLossWay(s, 0);
    confirmLosses(s);
    const before = s.state;
    stayOut(s, "M35");
    expect(s.state).toBe(before); // nothing was applied
    expect(openOffers(s, acts(s))).toEqual([]);
    expect(choiceHtml(s, acts(s))).toBe("");
    expect(plain(resultCardHtml(s))).toContain("Warsaw (M35) is empty. Your units stayed where they are.");
    expect(nextText(s, acts(s))).not.toContain("advance");
    expect(advanceOffers(acts(s))).toEqual(["M35"]); // the old list still has it
  });

  it("the picks are dropped with the Exchange, and with the Player Turn", () => {
    const s = atLosses();
    pickLossWay(s, 0);
    expect(pickedLosses(s)).toHaveLength(1);
    s.choice!.losses!.key = "other";
    expect(pickedLosses(s)).toEqual([]);
    normaliseChoice(s);
    expect(s.choice!.losses).toBeNull();
    s.choice!.turn = "1939-spring-allies";
    normaliseChoice(s);
    expect(s.choice).toBeNull();
  });

  it("the result card has no 'buttons above' wording, and points to nothing it does not show", () => {
    const s = atLosses();
    expect(plain(resultCardHtml(s))).toContain("The Exchange takes at least 4 factors of yours: you choose which units go.");
    expect(plain(attackHtml(s, acts(s)))).not.toMatch(/above|below/);
    pickLossWay(s, 0);
    confirmLosses(s);
    expect(plain(attackHtml(s, acts(s)))).not.toMatch(/above|below/);
  });
});

describe("the status column at step 7h", () => {
  it("leads with the Next bar and the pending choice, then the result; the nation table and the old buttons come after", () => {
    const s = e2eFixtureSession(27);
    openAttack(s, "M35");
    confirmAttack(s);
    const html = statusHtml(s, null, acts(s));
    const at = (needle: string) => html.indexOf(needle);
    expect(at('class="turn"')).toBeLessThan(at("nextbar"));
    expect(at("nextbar")).toBeLessThan(at("choicecard"));
    expect(at("choicecard")).toBeLessThan(at("resultcard"));
    expect(at("resultcard")).toBeLessThan(at("<table"));
    expect(at("<table")).toBeLessThan(at("All ways to lose, as a list"));
    expect(html).not.toContain('<div class="actions controls">'); // the step's own buttons are in the bar, once
  });

  it("the old coded buttons for the losses and the advance sit in fold-outs whose row is not `.actions` (the page's last `.actions` button moves the game on)", () => {
    const s = e2eFixtureSession(27);
    openAttack(s, "M35");
    confirmAttack(s);
    const html = statusHtml(s, null, acts(s));
    expect(html).toMatch(/<details class="declarations"><summary>All ways to lose, as a list \(2 choices\)<\/summary><div class="fold-buttons controls">/);
    expect(html.match(/class="actions controls/g)).toHaveLength(1); // only the Next bar
    expect(html).toContain("Lose 4-6 German armor from L35");
  });

  it("a battle shown while the computer chooses its losses has a bar with words and no buttons", () => {
    const pol = [POL("p1", "M33", 1), POL("p2", "M33", 1), POL("p3", "M33", 1), POL("p4", "M33", 1)];
    for (let seed = 1; seed < 400; seed++) {
      const s = createSession(SCENARIO_1939, "axis", seed);
      s.state = at7h([GER("g1", "M32", 3), GER("g2", "M32", 3), ...pol], seed);
      openAttack(s, "M33");
      confirmAttack(s);
      if (combatOf(s.state).pending?.chooser !== "allies") continue;
      const html = statusHtml(s, null, []);
      expect(plain(html)).toContain("Waiting for the computer to choose its losses.");
      expect(html).not.toContain("data-action");
      return;
    }
    throw new Error("no seed");
  });
});

describe("Escape in a card (spec 07 part D)", () => {
  it("cancels the attack draft and changes nothing in the game; any other key does nothing", () => {
    const s = e2eFixtureSession(4);
    openAttack(s, "M35");
    const state = s.state;
    const log = [...s.log];
    expect(onCardKey(s, "attack", "a")).toBe(false);
    expect(s.attack).not.toBeNull();
    expect(onCardKey(s, "attack", "Escape")).toBe(true);
    expect(s.attack).toBeNull();
    expect(s.state).toBe(state);
    expect(s.log).toEqual(log);
    expect(combatOf(s.state).attacked).toEqual([]);
  });

  it("closes the result card", () => {
    const s = e2eFixtureSession(4);
    openAttack(s, "M35");
    confirmAttack(s);
    expect(s.battle).not.toBeNull();
    expect(onCardKey(s, "result", "Enter")).toBe(false);
    expect(onCardKey(s, "result", "Escape")).toBe(true);
    expect(s.battle).toBeNull();
  });
});
