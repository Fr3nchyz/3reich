import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { airOf, markFlown } from "../src/engine/air-record";
import type { GameState, Unit } from "../src/engine/types";
import { airHtml } from "../src/ui/airCardView";
import { airPick } from "../src/ui/airPick";
import { cancelAir, confirmAir, normaliseAir, openAir, tapToAir, toggleAir } from "../src/ui/airTap";
import { attackHtml } from "../src/ui/attackView";
import { openAttack } from "../src/ui/attackTap";
import { syncAttackMarks } from "../src/ui/attackSync";
import type { MapView } from "../src/ui/mapView";
import type { Session } from "../src/ui/session";
import { normaliseMode, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { atMovement } from "./helpers-move-session";
import { ALL_OFFENSIVE, at6f, inf } from "./helpers-move";

// Spec 09, ticket 09-14 (rest): choosing individual planes at step 7b. Poznan (M33) holds Polish infantry; German infantry at M32 can attack it; the
// planes are at J32 (a 3-4 and a 2-4). Ground that could attack: 4 + 2 = 6 factors, so up to 18 air factors.

const air = (id: string, at: string, strength: number): Unit => inf(id, "germany", at, strength, 4, "air");
const UNITS = (): Unit[] => [inf("u1", "germany", "M32", 4, 3), inf("u2", "germany", "M32", 2, 3), inf("p1", "poland", "M33", 2, 3), air("a1", "J32", 3), air("a2", "J32", 2)];
const board = (units: Unit[], step: "7b" | "7h"): GameState => at6f(units, "axis", SCENARIO_1939, { nextUnitId: 100, frontOptions: ALL_OFFENSIVE, position: { part: "player-turn", turn: 1, step } });
const session = (units: Unit[] = UNITS(), step: "7b" | "7h" = "7b"): Session => {
  const s = atMovement();
  s.state = board(units, step);
  s.moveChosen = null;
  s.toast = "";
  s.log = [];
  return s;
};
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const page = (s: Session) => statusHtml(s, null, legalActions(s.ctx, s.state));
const hex = (s: Session, id: string) => s.ctx.map.hexes[id]!;
const chips = (s: Session) => airPick(s.ctx, s.state, "M33", s.airDraft!.units)!.chips;

describe("the air card at step 7b", () => {
  it("opens with every plane that fits chosen, as chips with their place and distance, and the totals", () => {
    const s = session();
    expect(openAir(s, "M33", true)).toBe(true);
    expect(s.airDraft).toMatchObject({ target: "M33", units: ["a1", "a2"], fresh: true, focus: true });
    const card = text(page(s));
    expect(card).toContain("Air support for Poznan (M33)");
    expect(card).toContain("Chosen 3-4 German air Rostock (J32), 4 hexes away");
    expect(card).toContain("Chosen 2-4 German air Rostock (J32), 4 hexes away");
    expect(card).toContain("Air chosen: 5 air factors. At most 18 air factors");
    expect(card).toContain("You must attack this hex this turn, or these planes are lost.");
    expect(card).toContain("Commit 2 planes (5 air factors) to Poznan (M33)");
    expect(card).not.toMatch(/\bu\d+\b|\ba\d\b/);
  });

  it("a plane chip adds or takes out one plane, and the button commits exactly the chosen ones", () => {
    const s = session();
    openAir(s, "M33");
    toggleAir(s, "a2");
    expect(chips(s).map((c) => [c.id, c.state])).toEqual([["a1", "chosen"], ["a2", "free"]]);
    expect(text(page(s))).toContain("Commit 1 plane (3 air factors) to Poznan (M33)");
    confirmAir(s);
    expect(s.toast).toBe("");
    expect(s.airDraft).toBeNull();
    expect(airOf(s.state).groundSupport.M33).toEqual(["a1"]);
    expect(s.log.join("\n")).toMatch(/3-4 German air fly ground support to Poznan \(M33\)/);
    expect(s.state.units.a2).toBeDefined();
  });

  it("the plane left out can be committed on its own later, and the card shows the first one as committed", () => {
    const s = session();
    openAir(s, "M33");
    toggleAir(s, "a2");
    confirmAir(s);
    expect(text(airHtml(s, legalActions(s.ctx, s.state)))).toContain("3 air factors already committed");
    openAir(s, "M33");
    expect(s.airDraft!.units).toEqual(["a2"]);
    expect(chips(s).map((c) => [c.id, c.state])).toEqual([["a1", "committed"], ["a2", "chosen"]]);
    const card = text(airHtml(s, legalActions(s.ctx, s.state)));
    expect(card).toContain("Already committed 3-4 German air");
    expect(card).toContain("Air chosen: 2 air factors, 3 air factors already committed.");
    toggleAir(s, "a1"); // a committed plane cannot be taken out
    expect(s.airDraft!.units).toEqual(["a2"]);
    confirmAir(s);
    expect(airOf(s.state).groundSupport.M33).toEqual(["a1", "a2"]);
  });

  it("a plane that would go over the cap is greyed with the reason, and is free again once another is taken out", () => {
    const small = UNITS().filter((u) => u.id !== "u1").map((u) => (u.id === "u2" ? { ...u, strength: 1 } : u)); // 1 ground factor: at most 3 air
    const s = session(small);
    openAir(s, "M33");
    expect(s.airDraft!.units).toEqual(["a1"]);
    const grey = chips(s).find((c) => c.id === "a2")!;
    expect(grey).toMatchObject({ state: "greyed", reason: "would take the air over the limit of 3 air factors for this hex" });
    expect(text(page(s))).toContain("Cannot fly 2-4 German air");
    toggleAir(s, "a2"); // refused: nothing changes
    expect(s.airDraft!.units).toEqual(["a1"]);
    toggleAir(s, "a1");
    expect(chips(s).map((c) => c.state)).toEqual(["free", "free"]);
    expect(airPick(s.ctx, s.state, "M33", [])!.button).toEqual({ text: "Choose at least one plane", disabled: true });
    confirmAir(s); // nothing chosen: the button is disabled and a press says why
    expect(s.toast).toBe("Choose at least one plane");
    expect(airOf(s.state).groundSupport.M33).toBeUndefined();
  });

  it("a plane that has flown, or was built this Game Turn, is listed with the reason and cannot be chosen", () => {
    const s = session();
    s.state = markFlown(markFlown(s.state, ["a1"], "ground-support"), ["a2"], "new");
    expect(legalActions(s.ctx, s.state).some((a) => a.type === "DESIGNATE_AIR")).toBe(false);
    const p = airPick(s.ctx, s.state, "M33", ["a1", "a2"])!;
    expect(p.chips.map((c) => [c.state, c.reason])).toEqual([["greyed", "has already flown a mission this Game Turn"], ["greyed", "was built this Game Turn and cannot fly a mission yet"]]);
    expect(p.chosen).toBe(0);
    expect(p.available).toEqual({ planes: 0, factors: 0 });
  });

  it("a plane of the other side that stands in range is not listed, and not committed to the Axis attack", () => {
    const s = session([...UNITS(), inf("b1", "britain", "J32", 3, 4, "air")]); // a British 3-4 next to the German planes
    expect(airPick(s.ctx, s.state, "M33", ["b1"])!.chips.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(airPick(s.ctx, s.state, "M33", ["b1"])!.chosen).toBe(0);
    openAir(s, "M33");
    expect(s.airDraft!.units).toEqual(["a1", "a2"]);
    expect(text(page(s))).not.toContain("British air");
  });

  it("a plane out of range is not listed at all, and a hex that cannot be attacked has no card", () => {
    const s = session([...UNITS(), air("a3", "A1", 5)]);
    expect(airPick(s.ctx, s.state, "M33", [])!.chips.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(airPick(s.ctx, s.state, "M34", [])).toBeNull();
    expect(openAir(s, "M34")).toBe(false);
    expect(s.airDraft ?? null).toBeNull();
  });

  it("Cancel and a second tap close it; a tap on a hex opens it; a tap elsewhere does nothing here", () => {
    const s = session();
    tapHex(s, hex(s, "M33"));
    expect(s.airDraft?.target).toBe("M33");
    tapHex(s, hex(s, "M33"));
    expect(s.airDraft).toBeNull();
    expect(tapToAir(s, hex(s, "M31"))).toBe(true); // handled (the hex card shows it), no card
    expect(s.airDraft ?? null).toBeNull();
    openAir(s, "M33");
    cancelAir(s);
    expect(s.airDraft).toBeNull();
    expect(legalActions(s.ctx, s.state).filter((a) => a.type === "DESIGNATE_AIR")).toHaveLength(1); // nothing was committed
  });

  it("the draft goes with the step, and loses a plane that can no longer fly", () => {
    const s = session();
    openAir(s, "M33");
    s.state = markFlown(s.state, ["a2"], "ground-support");
    normaliseMode(s);
    expect(s.airDraft!.units).toEqual(["a1"]);
    s.airDraft = { ...s.airDraft!, turn: "an earlier Player Turn" };
    normaliseAir(s);
    expect(s.airDraft).toBeNull();
    openAir(s, "M33");
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "7h" } };
    normaliseAir(s);
    expect(s.airDraft).toBeNull();
    expect(tapToAir(s, hex(s, "M33"))).toBe(false);
  });

  it("the map marks the hexes planes can go to, the open hex and the hexes of the chosen planes", () => {
    const s = session();
    const calls: { marks: unknown; focus: string[][] } = { marks: null, focus: [] };
    const view = { setAttackMarks: (m: unknown) => { calls.marks = m; }, clearAttackMarks: () => { calls.marks = null; }, focus: (ids: Iterable<string>) => { calls.focus.push([...ids]); } } as unknown as MapView;
    syncAttackMarks(view, s, legalActions(s.ctx, s.state));
    expect(calls.marks).toEqual({ targets: ["M33"], chosen: null, attackers: [] });
    openAir(s, "M33", true);
    syncAttackMarks(view, s, legalActions(s.ctx, s.state), () => false);
    expect(calls.marks).toEqual({ targets: ["M33"], chosen: "M33", attackers: ["J32", "J32"] });
    expect(calls.focus).toEqual([["M33", "J32", "J32"]]);
  });
});

describe("the attack card lists the planes that count", () => {
  const committed = (units: Unit[]): Session => {
    const s = session(units);
    openAir(s, "M33");
    confirmAir(s);
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "7h" } };
    return s;
  };

  it("one chip-like line per plane that counts, with the place it flew from, that cannot be pressed", () => {
    const s = committed(UNITS());
    expect(openAttack(s, "M33")).toBe(true);
    const html = attackHtml(s, legalActions(s.ctx, s.state));
    expect(html.match(/class="air-plane"/g)).toHaveLength(2);
    expect(text(html)).toMatch(/Counts in this attack 3-4 German air from .*Counts in this attack 2-4 German air from /);
    expect(text(html)).toContain("5 air factors count in this attack. They cannot be taken back");
    expect(html).not.toMatch(/<button[^>]*air-plane/);
    expect(text(html)).not.toMatch(/\bu\d+\b|\ba\d\b/);
  });

  it("a plane the cap leaves out is listed as not counted, and the sentence says it stays committed", () => {
    const s = committed(UNITS());
    const one = { ...s.state, units: Object.fromEntries(Object.entries(s.state.units).filter(([id]) => id !== "u1")) };
    s.state = { ...one, units: { ...one.units, u2: { ...one.units.u2!, strength: 1 } } }; // 1 ground factor: at most 3 air counts
    openAttack(s, "M33");
    const html = attackHtml(s, legalActions(s.ctx, s.state));
    expect(html.match(/class="air-plane"/g)).toHaveLength(1);
    expect(html.match(/class="air-plane left-out"/g)).toHaveLength(1);
    expect(text(html)).toContain("Not counted: over the limit 2-4 German air");
    expect(text(html)).toContain("The planes not counted stay committed and are not lost.");
  });
});
