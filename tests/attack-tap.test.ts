import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { combatOf } from "../src/engine/combat-record";
import type { GameState, Unit } from "../src/engine/types";
import { attackTargets, attackersOf, newDraft, reconciled, toggled } from "../src/ui/attackDraft";
import { attackHtml } from "../src/ui/attackView";
import { syncAttackMarks } from "../src/ui/attackSync";
import type { MapView } from "../src/ui/mapView";
import { cancelAttack, confirmAttack, normaliseAttack, openAttack, targetsNow, toggleAttacker } from "../src/ui/attackTap";
import { createSession, type Session } from "../src/ui/session";
import { lookAt, normaliseMode, takeAction, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { newWatchSession } from "../src/ui/watchPlay";
import { GER, POL, at7h, spent } from "./preview-helpers";

/**
 * Spec 07 ticket 07-6: the draft of an attack and the tap flow at step 7h (Ref 12.1; PC README 14.23). Positions are on the real map:
 * Warsaw M35 is next to M34 and N34, Poznan M33 next to M32; the Axis (the player) is to move at step 7h.
 */

const hexOf = (s: Session, id: string) => s.ctx.map.hexes[id]!;

/** A session in play with the player (Axis) at step 7h of this position. */
function session(units: Unit[], seed = 1, extra: Partial<GameState> = {}): Session {
  const s = createSession(SCENARIO_1939, "axis", seed);
  s.state = at7h(units, seed, extra);
  s.log = [];
  s.record = []; // spec 11 ticket 11-3: every session keeps a record.
  return s;
}

const WARSAW = [GER("g1", "M34", 3), GER("g2", "N34", 2), GER("g3", "N34", 2), POL("p1", "M35", 1), POL("p2", "M35", 1), POL("a1", "M35", 1, "air")];
const TWO_TARGETS = [...WARSAW, GER("g4", "M32", 3), POL("p3", "M33", 1)];
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const html = (s: Session) => statusHtml(s, null, legalActions(s.ctx, s.state));

describe("the draft (pure helpers)", () => {
  const actions: Action[] = [
    { type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M35" },
    { type: "ATTACK", side: "axis", units: ["g1"], target: "M35" },
    { type: "ATTACK", side: "axis", units: ["g4"], target: "M33" },
    { type: "END_STEP", side: "axis", step: "7h" },
  ];
  const state = at7h([]);
  it("reads the targets and the units that can attack each from the engine's listing", () => {
    expect(attackTargets(actions)).toEqual(["M35", "M33"]);
    expect(attackersOf(actions, "M35")).toEqual(["g1", "g2"]);
  });
  it("toggles a unit in and out, and a draft never keeps a unit that can no longer attack", () => {
    const d = newDraft(state, "M35", ["g1", "g2"], false);
    expect(toggled(d, "g1").units).toEqual(["g2"]);
    expect(toggled(toggled(d, "g1"), "g1").units).toEqual(["g2", "g1"]);
    expect(reconciled(d, state, actions)).toBe(d);
    expect(reconciled(d, state, actions.slice(1))?.units).toEqual(["g1"]);
  });
  it("is dropped when its hex can no longer be attacked or the Player Turn is another", () => {
    const d = newDraft(state, "M35", ["g1"], false);
    expect(reconciled(d, state, actions.slice(2))).toBeNull();
    expect(reconciled(d, { ...state, activeSide: "allies" }, actions)).toBeNull();
    expect(reconciled(null, state, actions)).toBeNull();
  });
});

describe("tapping at step 7h (spec 07, the touch flow)", () => {
  it("a red hex opens the card with every unit that can attack chosen; the hex of the open card closes it; another red hex moves it", () => {
    const s = session(TWO_TARGETS);
    expect(targetsNow(s)).toEqual(["M33", "M35"]);
    tapHex(s, hexOf(s, "M35"));
    expect(s.attack).toMatchObject({ target: "M35", units: ["g1", "g2", "g3"] });
    tapHex(s, hexOf(s, "M33"));
    expect(s.attack).toMatchObject({ target: "M33", units: ["g1", "g4"] }); // M34 is next to Poznan too
    tapHex(s, hexOf(s, "M33"));
    expect(s.attack).toBeNull();
    expect(s.state).toEqual(session(TWO_TARGETS).state); // nothing was rolled or changed
  });

  it("any other hex only fills the hex card; the open draft stays", () => {
    const s = session(TWO_TARGETS);
    openAttack(s, "M35");
    const draft = s.attack;
    tapHex(s, hexOf(s, "N40"));
    expect(s.attack).toBe(draft);
    expect(s.lookedAt).toBe("N40");
    tapHex(s, hexOf(s, "M34")); // a hex of the attackers: no attack target either
    expect(s.attack).toBe(draft);
  });

  it("a hex with no draft that cannot be attacked opens nothing and changes nothing but the look", () => {
    const s = session(TWO_TARGETS);
    const before = { ...s, lookedAt: undefined };
    tapHex(s, hexOf(s, "N40"));
    expect({ ...s, lookedAt: undefined, toast: before.toast }).toEqual(before);
  });

  it("the list path opens the same card (and asks the map to show it)", () => {
    const s = session(TWO_TARGETS);
    expect(openAttack(s, "M35", true)).toBe(true);
    expect(s.attack).toMatchObject({ target: "M35", units: ["g1", "g2", "g3"], focus: true, fresh: true });
    expect(openAttack(s, "N40")).toBe(false);
    expect(s.attack?.target).toBe("M35");
  });

  it("chips add and remove units; a greyed unit cannot be added; Cancel throws the draft away", () => {
    const s = session(WARSAW);
    const spentState = spent(s.state, ["g3"]);
    s.state = spentState;
    openAttack(s, "M35");
    expect(s.attack?.units).toEqual(["g1", "g2"]);
    toggleAttacker(s, "g3");
    expect(s.attack?.units).toEqual(["g1", "g2"]);
    toggleAttacker(s, "g2");
    expect(s.attack?.units).toEqual(["g1"]);
    toggleAttacker(s, "g2");
    expect(s.attack?.units).toEqual(["g1", "g2"]);
    cancelAttack(s);
    expect(s.attack).toBeNull();
    expect(s.state).toBe(spentState);
  });
});

describe("Confirm (one ATTACK action through applyAction)", () => {
  it("makes exactly the action the card names, the same result as applyAction, and shows the result card", () => {
    const s = session(WARSAW, 5);
    s.record = [];
    openAttack(s, "M35");
    toggleAttacker(s, "g3");
    const expected = applyAction(s.ctx, s.state, { type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M35" });
    expect(expected.ok).toBe(true);
    confirmAttack(s);
    expect(s.record).toEqual([{ type: "ATTACK", side: "axis", units: ["g1", "g2"], target: "M35" }]);
    expect(s.state).toEqual(expected.ok ? expected.state : null);
    expect(s.attack).toBeNull();
    expect(s.log.some((l) => l.startsWith("Attack on Warsaw (M35):"))).toBe(true);
    expect(combatOf(s.state).targets).toEqual(["M35"]);
    expect(s.battle).toMatchObject({ target: "M35", side: "axis", fresh: true });
    expect(s.battle?.rounds.length).toBeGreaterThan(0);
  });

  it("with no unit chosen the button is refused and says why, and nothing changes", () => {
    const s = session(WARSAW);
    openAttack(s, "M35");
    for (const id of ["g1", "g2", "g3"]) toggleAttacker(s, id);
    const before = s.state;
    confirmAttack(s);
    expect(s.state).toBe(before);
    expect(s.toast).toBe("Choose at least one unit to attack with");
    expect(s.attack).not.toBeNull();
  });

  it("every subset the card can build is accepted by the engine (spec 07 B1)", () => {
    const ids = ["g1", "g2", "g3"];
    for (let mask = 1; mask < 8; mask++) {
      const s = session(WARSAW, mask);
      openAttack(s, "M35");
      for (const [i, id] of ids.entries()) if (!(mask & (1 << i))) toggleAttacker(s, id);
      s.record = [];
      confirmAttack(s);
      expect(s.record, `subset ${mask}`).toHaveLength(1);
      expect(s.toast).toBe("");
    }
  });

  it("the old coded button for the same hex still works, and clears the draft by itself", () => {
    const s = session(WARSAW);
    openAttack(s, "M35");
    const old = legalActions(s.ctx, s.state).find((a) => a.type === "ATTACK")!;
    takeAction(s, old);
    normaliseMode(s);
    expect(s.attack).toBeNull();
    expect(combatOf(s.state).targets).toEqual(["M35"]);
  });
});

describe("when the draft goes", () => {
  it("at the end of the step, at the end of the turn, in the computer's turn, in watch mode, in a new game", () => {
    const s = session(TWO_TARGETS);
    openAttack(s, "M35");
    takeAction(s, { type: "END_STEP", side: "axis", step: "7h" });
    normaliseMode(s);
    expect(s.attack).toBeNull();

    const t = session(TWO_TARGETS);
    openAttack(t, "M35");
    t.state = { ...t.state, activeSide: "allies" };
    normaliseMode(t);
    expect(t.attack).toBeNull();

    const w = session(TWO_TARGETS);
    openAttack(w, "M35");
    w.watch = newWatchSession(SCENARIO_1939, 1, "normal", 1).watch;
    normaliseAttack(w);
    expect(w.attack).toBeNull();

    expect(createSession(SCENARIO_1939, "axis", 1).attack).toBeUndefined();
  });

  it("when its hex has been attacked meanwhile, and units that have attacked leave it", () => {
    const s = session(TWO_TARGETS);
    openAttack(s, "M35");
    s.state = spent(s.state, ["g2"]);
    normaliseAttack(s);
    expect(s.attack?.units).toEqual(["g1", "g3"]);
    s.state = spent(s.state, ["g2"], ["M35"]);
    normaliseAttack(s);
    expect(s.attack).toBeNull();
  });

  it("not at 6f, not with an Exchange waiting", () => {
    const s = session(TWO_TARGETS);
    openAttack(s, "M35");
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "6f" } };
    normaliseAttack(s);
    expect(s.attack).toBeNull();
    expect(attackHtml(s, [])).toBe("");
  });
});

describe("no attack card and no list for the computer's turn or in watch mode", () => {
  it("shows nothing, whatever the position", () => {
    const s = session(TWO_TARGETS);
    expect(attackHtml(s, legalActions(s.ctx, s.state))).toContain("Attacks you can make (2)");
    const comp = session(TWO_TARGETS);
    comp.state = { ...comp.state, activeSide: "allies" };
    expect(attackHtml(comp, [])).toBe("");
    expect(targetsNow(comp)).toEqual([]);
    const watch = session(TWO_TARGETS);
    watch.watch = newWatchSession(SCENARIO_1939, 1, "normal", 1).watch;
    expect(attackHtml(watch, legalActions(watch.ctx, watch.state))).toBe("");
    tapHex(watch, hexOf(watch, "M35"));
    expect(watch.attack).toBeFalsy();
    expect(watch.lookedAt).toBe("M35"); // inspection still works
  });
});

describe("what the status area shows at step 7h", () => {
  it("one row per attackable hex with the place, the defenders and the factors; no unit id anywhere", () => {
    const s = session(TWO_TARGETS);
    const t = text(attackHtml(s, legalActions(s.ctx, s.state)));
    expect(t).toContain("Attacks you can make (2)");
    expect(t).toContain("Warsaw (M35)");
    expect(t).toContain("2 x 1-3 Polish infantry".replace("1-3", "1")); // the test counters have no movement number
    expect(t).toMatch(/you can bring 7 factors/);
    expect(t).not.toMatch(/\bu\d+\b|\b[gp]\d\b/);
  });

  it("the card: defenders with the reason for the multiple, chips, odds, the six results, the one button", () => {
    const s = session(WARSAW);
    openAttack(s, "M35");
    const h = html(s);
    const t = text(h);
    expect(t).toContain("Attack on Warsaw (M35)");
    expect(t).toContain("behind a river or crossing arrow: tripled (every attacker is across it), so 6 to beat");
    expect(t).toContain("Polish air do not defend");
    expect(h.match(/<button[^>]*data-unit=/g)).toHaveLength(3);
    expect(h.match(/aria-pressed="true"[^>]*data-unit|data-unit="[^"]+" aria-pressed="true"/g)).toHaveLength(3);
    expect(t).toContain("Odds: 7 against 6, column 1-1.");
    expect(h).toContain('id="attack-go"');
    expect(t).toContain("Attack Warsaw (M35) with 3 units (7 factors)");
    expect(t).not.toMatch(/\bu\d+\b|\b[gp]\d\b/);
    expect(h.match(/<ol class="results">/)).not.toBeNull();
  });

  it("the old coded attack buttons sit in a fold-out with readable labels, not among the step buttons", () => {
    const s = session(WARSAW);
    const h = html(s);
    const fold = h.match(/<details class="declarations"[^>]*><summary>All attacks as a list \((\d+) choices\)<\/summary>(.*?)<\/details>/s);
    expect(fold).not.toBeNull();
    expect(Number(fold![1])).toBeGreaterThan(0);
    expect(fold![2]).toContain("Attack Warsaw (M35) with ");
    expect(fold![2]).not.toMatch(/\bu\d+\b|\b[gp]\d\b/);
    const outside = h.replace(fold![0], "");
    expect(outside).not.toMatch(/<button data-action="\d+">Attack /);
    expect(outside).toContain("Done with step 7h");
  });

  it("an amber, honest button when the odds are bad", () => {
    const s = session([GER("g1", "M32", 2), POL("p1", "M33", 2)]);
    openAttack(s, "M33");
    expect(html(s)).toContain('class="attack-go risky"');
    expect(text(html(s))).toContain("at 1-2 (risky)");
  });

  it("an enemy hex that cannot be attacked says why on the hex card; a hex that can, does not", () => {
    const s = session([...TWO_TARGETS, POL("far", "N40", 1)]);
    tapHex(s, hexOf(s, "N40"));
    expect(text(html(s))).toContain("None of your units that have not attacked is next to this hex.");
    const only = session(WARSAW);
    only.state = spent(only.state, [], ["M35"]);
    tapHex(only, hexOf(only, "M35"));
    expect(text(html(only))).toContain("This hex has already been attacked this turn.");
    const open = session(TWO_TARGETS);
    openAttack(open, "M35");
    tapHex(open, hexOf(open, "M33")); // another red hex: moves the draft, no sentence
    expect(text(html(open))).not.toContain("None of your units");
    const other = session(TWO_TARGETS);
    openAttack(other, "M35");
    lookAt(other, "M33"); // looking at a hex that can be attacked (the draft is on M35): the card says nothing about why not
    expect(text(html(other))).toContain("Poznan (M33)");
    expect(text(html(other))).not.toMatch(/No unit is chosen|None of your units|not at war|Attacks are made/);
  });
});

describe("the marks on the map follow the card (spec 07, 07-5 layer)", () => {
  function fake() {
    const calls: { marks: unknown; focus: string[][] } = { marks: "none", focus: [] };
    const view = { setAttackMarks: (m: unknown) => { calls.marks = m; }, clearAttackMarks: () => { calls.marks = null; }, focus: (ids: Iterable<string>) => { calls.focus.push([...ids]); } } as unknown as MapView;
    return { calls, view };
  }
  it("dashes every target, then the chosen target and the hexes of the chosen units as the chips change", () => {
    const s = session(TWO_TARGETS);
    const { calls, view } = fake();
    syncAttackMarks(view, s, legalActions(s.ctx, s.state));
    expect(calls.marks).toEqual({ targets: ["M33", "M35"], chosen: null, attackers: [] });
    openAttack(s, "M35", true);
    syncAttackMarks(view, s, legalActions(s.ctx, s.state), () => false); // the target is off the visible map
    expect(calls.marks).toEqual({ targets: ["M33", "M35"], chosen: "M35", attackers: ["M34", "N34", "N34"] });
    expect(calls.focus).toEqual([["M35", "M34", "N34", "N34"]]);
    toggleAttacker(s, "g1");
    syncAttackMarks(view, s, legalActions(s.ctx, s.state));
    expect(calls.marks).toMatchObject({ attackers: ["N34", "N34"] });
    expect(calls.focus).toHaveLength(1); // the map moved once, when the card opened from the list
  });
  it("leaves the map alone when the target and its attackers are already in sight", () => {
    const s = session(TWO_TARGETS);
    const { calls, view } = fake();
    openAttack(s, "M35", true);
    syncAttackMarks(view, s, legalActions(s.ctx, s.state), () => true);
    expect(calls.focus).toEqual([]);
    expect(s.attack?.focus).toBe(false);
  });
  it("shows no marks on the computer's turn, in watch mode or at another step", () => {
    const s = session(TWO_TARGETS);
    const { calls, view } = fake();
    s.state = { ...s.state, activeSide: "allies" };
    syncAttackMarks(view, s, []);
    expect(calls.marks).toBeNull();
    const six = session(TWO_TARGETS);
    six.state = { ...six.state, position: { part: "player-turn", turn: 1, step: "6f" } };
    calls.marks = "none";
    syncAttackMarks(view, six, []);
    expect(calls.marks).toBeNull();
  });
});
