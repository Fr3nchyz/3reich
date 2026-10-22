import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import type { GameState, Side } from "../src/engine/types";
import { winterInForce, winterKey } from "../src/engine/winter-record";
import { runGame, type Hooks } from "../scripts/selfplay/runner";
import { attackPreview, defaultAttackers } from "../src/ui/attackPreview";
import { rowLines } from "../src/ui/attackText";
import { axisUnitsLine, diceLine, testLine, winterBanner, WINTER_TEXT } from "../src/ui/endText";
import { computerToMove } from "../src/ui/computerPlay";
import { createSession, type Session } from "../src/ui/session";
import { takeAction } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { frontOptionButtons, greyedOffensive, winterBannerHtml, winterCard, winterCardHtml } from "../src/ui/winterCard";
import { newWatchSession } from "../src/ui/watchPlay";
import { multipleWord } from "../src/ui/attackResults";
import { CTX } from "./helpers";
import { allied7h, axis3, ger, KEY, PLAIN, rus, WINTER } from "./helpers-winter";

// Spec 14 ticket 14-13 (part D4): the Russian winter on the screen. The card at II.A, the banner, the greyed Offensive button, the line in the attack card.
// Every number is the record's or the engine's; the sentences are the ones of ui/endText.ts.

const warWithRussia: NonNullable<Hooks["prepare"]> = (s) => ({ ...s, wars: [...s.wars, ["germany", "ussr"]], nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" } } });

/** A session standing at the question of II.A (the Allies are asked), the human playing `human`. */
let questionState: GameState | undefined;
function atQuestion(human: Side): Session {
  questionState ??= runGame({ scenario: "1939", seed: 1, turns: 1, verify: false }, { prepare: warWithRussia }).final;
  const s = createSession(SCENARIO_1939, human, 1);
  s.state = questionState;
  return s;
}
const sessionAt = (state: GameState, human: Side = "axis"): Session => Object.assign(createSession(SCENARIO_1939, human, 1), { state });
/** What the page draws: no buttons while the computer is the one to move, as main.ts does. */
const html = (s: Session) => statusHtml(s, null, s.state.phase === "player-turn" && !computerToMove(s) ? legalActions(s.ctx, s.state) : []);
const roll = { dice: [6, 6, 6, 6], total: 24, axisUnits: 30, mayPostpone: false };

describe("the words: dice, count and test", () => {
  it("say the sum, the count with the Finns left out, and the test both ways", () => {
    expect(diceLine([4, 6, 3, 5], 18)).toBe("Dice: 4 + 6 + 3 + 5 = 18");
    expect(axisUnitsLine(12)).toBe("Axis ground units inside Russia: 12 (not counting Finns).");
    expect(axisUnitsLine(1)).toBe("Axis ground units inside Russia: 1 (not counting Finns).");
    expect(testLine(12, 18, true, false)).toBe("12 is fewer than 18, so Russia may wait one year.");
    expect(testLine(18, 18, false, false)).toBe("18 is not fewer than 18, so Russia may not wait.");
    expect(testLine(12, 18, true, true)).toBe("12 is fewer than 18, so Russia could wait one year; it chose to start the winter now.");
  });
  it("the banner names the turn, the defence and the Option", () => {
    expect(winterBanner()).toBe("Russian winter this turn. In Russia the Axis defence is not doubled. The Axis may not use an Offensive Option in the East.");
  });
});

describe("the card at II.A (the model)", () => {
  it("asked: the dice, the count, the test and what the winter does, from the record", () => {
    const s = atQuestion("allies");
    const w = s.state.winter!;
    expect(w.asking).toBe(true);
    const c = winterCard(s.state, undefined)!;
    expect(c.kind).toBe("ask");
    expect(c.title).toBe("Russian winter");
    expect(c.lines).toEqual([
      WINTER_TEXT.first,
      diceLine(w.roll!.dice, w.roll!.total),
      axisUnitsLine(w.roll!.axisUnits),
      testLine(w.roll!.axisUnits, w.roll!.total, true, false),
      "If the winter starts now, for this Game Turn: in Russia the Axis defence is not doubled. The Axis may not use an Offensive Option in the East.",
    ]);
  });
  it("told, with no choice: the same facts, the test says Russia may not wait, and the card is only for telling", () => {
    const s = allied7h([], {}, { stage: "over", inForce: KEY, asking: false, roll });
    const c = winterCard(s, undefined)!;
    expect(c.kind).toBe("info");
    expect(c.lines).toContain("30 is not fewer than 24, so Russia may not wait.");
    expect(c.lines.at(-1)).toMatch(/^For this Game Turn: in Russia/);
  });
  it("told after the Allies chose to start it: the test says they could have waited", () => {
    const c = winterCard(allied7h([], {}, { stage: "over", inForce: KEY, asking: false, roll: { ...roll, axisUnits: 5, mayPostpone: true } }), undefined)!;
    expect(c.lines).toContain("5 is fewer than 24, so Russia could wait one year; it chose to start the winter now.");
  });
  it("told for a postponed winter: no dice of its own (the old roll is not shown), the Game Turn it was put off from", () => {
    const w = { stage: "over", inForce: "1942-winter", asking: false, roll: { ...roll, mayPostpone: true }, postponedFrom: { year: 1941, season: "winter" } } as const;
    const c = winterCard(allied7h([], { year: 1942 }, w), undefined)!;
    expect(c.lines[0]).toBe("The Russian winter that Russia put off from Winter 1941 starts now.");
    expect(c.lines.join(" ")).not.toContain("Dice");
  });
  it("told for a Russian declaration in a Winter turn: no dice, and Russia could not put it off", () => {
    const c = winterCard(allied7h([], {}, { stage: "over", inForce: KEY, asking: false }), undefined)!;
    expect(c.lines[0]).toBe(WINTER_TEXT.declared);
    expect(c.lines.join(" ")).not.toContain("Dice");
  });
  it("is nothing when there is no record, the winter is not in force, it was seen, or the game is over", () => {
    expect(winterCard(allied7h([], {}, null), undefined)).toBeNull();
    expect(winterCard(allied7h([], { year: 1942, season: "spring" }), undefined)).toBeNull();
    expect(winterCard(allied7h([], { year: 1942, season: "winter" }), undefined)).toBeNull();
    expect(winterCard(allied7h([], {}), KEY)).toBeNull();
    expect(winterCard(allied7h([], { phase: "game-over" }), undefined)).toBeNull();
    expect(winterCard(allied7h([], {}, { stage: "postponed", asking: false, postponedFrom: { year: 1941, season: "winter" } }), undefined)).toBeNull();
  });
});

describe("the status area at II.A", () => {
  it("a human Allied player sees the card with the dice and two buttons, waiting first, each a real answer, and the generic list repeats neither", () => {
    const s = atQuestion("allies");
    const h = html(s);
    const card = h.slice(h.indexOf('id="winter-card"'), h.indexOf("</section>", h.indexOf('id="winter-card"')));
    expect(card).toContain('data-kind="ask"');
    expect(card).toContain("Dice: ");
    expect(card.indexOf("Wait for next winter")).toBeGreaterThan(0);
    expect(card.indexOf("Winter starts now")).toBeGreaterThan(card.indexOf("Wait for next winter"));
    expect((h.match(/Wait for next winter/g) ?? []).length).toBe(1);
    expect((h.match(/Winter starts now/g) ?? []).length).toBe(1);
    expect(h).not.toContain("CHOOSE_WINTER");
    expect(h).toContain("step II.A (Russian winter): the Allies say whether it waits");
    expect(h).not.toContain("winter-banner"); // the winter is not on yet
    // each button is the engine's own action, by its index in the legal list
    const legal = legalActions(s.ctx, s.state);
    const idx = [...card.matchAll(/data-action="(\d+)"[^>]*>([^<]*)</g)].map((m) => [legal[Number(m[1])], m[2]] as const);
    expect(idx).toEqual([[{ type: "CHOOSE_WINTER", side: "allies", postpone: true }, "Wait for next winter"], [{ type: "CHOOSE_WINTER", side: "allies", postpone: false }, "Winter starts now"]]);
  });
  it("the human Axis player has no card (the computer answers) and the line says so; a watched game says the same", () => {
    const s = atQuestion("axis");
    const h = html(s);
    expect(h).not.toContain("winter-card");
    expect(h).toContain("step II.A (Russian winter): the computer, playing the Allies, decides whether it waits");
    const w = newWatchSession(SCENARIO_1939, 7, "turbo", 3);
    w.state = atQuestion("axis").state;
    expect(statusHtml(w, null, [])).toContain("the computer, playing the Allies, decides whether it waits");
  });
  it("a card that asks is not drawn without the buttons, and one that tells is not drawn to a watcher", () => {
    expect(winterCardHtml(atQuestion("allies"), "")).toBe("");
    const w = sessionAt(allied7h([], {}, { stage: "over", inForce: KEY, asking: false, roll }));
    expect(winterCardHtml(w, "")).toContain("winter-ok");
    w.watch = { speed: 1 } as never;
    expect(winterCardHtml(w, "")).toBe("");
  });
});

describe("the banner and the card that tells", () => {
  const inForce = () => sessionAt(allied7h([], {}, { stage: "over", inForce: KEY, asking: false, roll }), "allies");
  it("the banner is on for the whole Game Turn, in either Player Turn, and not in any other", () => {
    const s = inForce();
    expect(html(s)).toContain('<p class="winter-banner" role="note">Russian winter this turn. In Russia the Axis defence is not doubled.');
    expect(winterBannerHtml({ ...s.state, activeSide: "axis" })).toContain("winter-banner");
    for (const t of [{ year: 1942, season: "spring" }, { year: 1941, season: "fall" }, { year: 1942, season: "winter" }] as const) expect(winterBannerHtml({ ...s.state, ...t })).toBe("");
    expect(winterBannerHtml({ ...s.state, winter: undefined })).toBe("");
    expect(winterInForce(s.state)).toBe(true);
  });
  it("the card that tells has one OK button until it is pressed, then only the banner is left", () => {
    const s = inForce();
    const h = html(s);
    expect(h).toContain('data-kind="info"');
    expect(h).toContain('<button type="button" id="winter-ok">OK, the winter starts now</button>');
    s.winterSeen = KEY;
    const after = html(s);
    expect(after).not.toContain("winter-card");
    expect(after).toContain("winter-banner");
  });
  it("answering the question \"start now\" marks the winter seen (no card after it); waiting leaves no banner", () => {
    const now = atQuestion("allies");
    takeAction(now, { type: "CHOOSE_WINTER", side: "allies", postpone: false });
    expect(now.state.winter).toMatchObject({ stage: "over", inForce: winterKey(now.state) });
    const h = html(now);
    expect(h).toContain("winter-banner");
    expect(h).not.toContain("winter-card");
    const wait = atQuestion("allies");
    takeAction(wait, { type: "CHOOSE_WINTER", side: "allies", postpone: true });
    const w = html(wait);
    expect(w).not.toContain("winter-banner");
    expect(w).not.toContain("winter-card");
  });
  it("the banner is not drawn in setup or when the game is over", () => {
    expect(winterBannerHtml({ ...inForce().state, phase: "game-over" })).toBe("");
    expect(winterBannerHtml({ ...inForce().state, phase: "setup" })).toBe("");
  });
});

describe("step 3: the greyed Offensive button", () => {
  const axis = (winter: GameState["winter"] | null = WINTER, tweak: Partial<GameState> = {}) => sessionAt(axis3(winter, tweak));
  it("is shown greyed in the fold of Front Options, before the Eastern Front's other choices, with its reason; it is not an action", () => {
    const s = axis();
    const h = html(s);
    const grey = h.indexOf('class="greyed"');
    expect(grey).toBeGreaterThan(0);
    expect(h).toContain('aria-disabled="true" data-winterwhy="1"');
    expect(h).toContain(`title="${WINTER_TEXT.greyedReason}"`);
    expect(h).toContain(">Eastern Front: Offensive Option</button>");
    expect(grey).toBeLessThan(h.indexOf(">Eastern Front: Attrition Option</button>"));
    expect(grey).toBeGreaterThan(h.indexOf(">Western Front: Defensive Option</button>"));
    // the rest of the choices are there as buttons, the Offensive one of the East only as the greyed one
    expect(h).toContain(">Western Front: Offensive Option (15 BRPs from Germany)</button>");
    expect(h).not.toMatch(/data-action="\d+"[^>]*>Eastern Front: Offensive Option/);
    expect(legalActions(s.ctx, s.state).some((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "eastern" && a.option === "offensive")).toBe(false);
    expect(greyedOffensive(s.state)).toEqual({ text: "Eastern Front: Offensive Option", reason: WINTER_TEXT.greyedReason });
  });
  it("is not there when the winter is not on, at another step, for the Allies, or once the Eastern Front has its Option", () => {
    const off = html(axis(null));
    expect(off).not.toContain("greyed");
    expect(off).toMatch(/data-action="\d+"[^>]*>Eastern Front: Offensive Option/);
    expect(greyedOffensive(axis(null).state)).toBeNull();
    expect(greyedOffensive({ ...axis().state, position: { part: "player-turn", turn: 1, step: "7h" } })).toBeNull();
    expect(greyedOffensive({ ...axis().state, activeSide: "allies" })).toBeNull();
    expect(greyedOffensive({ ...axis().state, frontOptions: { eastern: { option: "attrition" } } })).toBeNull();
    const chosen = axis(WINTER, { frontOptions: { eastern: { option: "attrition" } } });
    expect(html(chosen)).not.toContain("greyed");
  });
  it("frontOptionButtons puts the grey button in front of the first Eastern choice and leaves a group without one as it is", () => {
    const s = axis().state;
    const group = legalActions(CTX, s).filter((a) => a.type === "SELECT_FRONT_OPTION");
    const out = frontOptionButtons(s, group, (a) => `<b>${a.type === "SELECT_FRONT_OPTION" ? a.front + a.option : ""}</b>`);
    expect(out.indexOf("greyed")).toBeGreaterThan(out.indexOf("<b>westerndefensive</b>"));
    expect(out.indexOf("greyed")).toBeLessThan(out.indexOf("<b>easternattrition</b>"));
    const west = group.filter((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "western");
    expect(frontOptionButtons(s, west, () => "<i></i>")).not.toContain("greyed");
  });
});

describe("the attack card (the preview line)", () => {
  it("says Russian winter: Axis defence not doubled, with the smaller number to beat, and the list of attacks says Russian winter x1", () => {
    const s = sessionAt(allied7h([ger("g", PLAIN.at), rus("r", PLAIN.from, 4), rus("q", PLAIN.from, 5)]), "allies");
    const p = attackPreview(s.ctx, s.state, PLAIN.at, defaultAttackers(s.ctx, s.state, PLAIN.at));
    expect(p.numbers).toMatchObject({ multiplier: 1, basis: "winter", defenseTotal: 3, multiplierReason: "Russian winter: Axis defence not doubled" });
    expect(p.numbers!.oddsText).toBe("9 against 3, column 3-1.");
    expect(rowLines(p).defence).toMatch(/ = 3 factors, Russian winter x1$/);
    const after = createSession(SCENARIO_1939, "allies", 1);
    after.state = { ...s.state, year: 1942, season: "spring" };
    const plain = attackPreview(after.ctx, after.state, PLAIN.at, defaultAttackers(after.ctx, after.state, PLAIN.at));
    expect(plain.numbers).toMatchObject({ multiplier: 2, basis: "plain", defenseTotal: 6 });
  });
  it("a unit added that cancels a river bonus is worded for a defence counted once", () => {
    expect(multipleWord(1)).toBe("counted once");
    expect(multipleWord(3)).toBe("tripled");
  });
});
