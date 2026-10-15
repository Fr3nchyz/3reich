import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { cardFor } from "../src/ui/hexCardView";
import { moveTargets, movesNow } from "../src/ui/moveTap";
import { computerToMove } from "../src/ui/computerPlay";
import { createSession, setupView, type Session } from "../src/ui/session";
import { closeLook, fillRest, finishOwner, lookAt, pickBuild, pickSpec, setMode, takeAction, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { newWatchSession } from "../src/ui/watchPlay";

/**
 * Tapping a hex to look at it (spec 07, part A, "Rules of the card"): the card fills on every tap from the first Player Turn on, and
 * looking never changes a move, a build, a setup choice or the game. The routing rule: a tap always does what the step asks of it, and
 * it also sets `lookedAt`; nothing else reads `lookedAt` but the card.
 */

const html = (s: Session) => statusHtml(s, setupView(s), s.state.phase === "player-turn" && !computerToMove(s) ? legalActions(s.ctx, s.state) : []);
const hexOf = (s: Session, id: string) => s.ctx.map.hexes[id]!;

function setupSession(): Session {
  return createSession(SCENARIO_1939, "axis", 1);
}

function inPlay(): Session {
  const s = setupSession();
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) finishOwner(s, v.owner);
  }
  expect(s.state.phase).toBe("player-turn");
  return s;
}

const toStep = (s: Session, step: string) => {
  for (let i = 0; i < 12 && !(s.state.position?.part === "player-turn" && s.state.position.step === step); i++) takeAction(s, legalActions(s.ctx, s.state).at(-1)!);
  expect(s.state.position).toMatchObject({ step });
};

/** The whole session as data, with the one field that looking may change left out. */
const without = (s: Session) => JSON.stringify({ ...s, lookedAt: undefined });

describe("the card is not there during setup", () => {
  it("a tap during setup does not fill it, and the setup screen is as before", () => {
    const s = setupSession();
    expect(setupView(s)).not.toBeNull();
    const places = Object.values(s.ctx.map.hexes).slice(0, 5);
    for (const h of places) tapHex(s, h);
    expect(s.lookedAt ?? null).toBeNull();
    expect(html(s)).not.toContain("hexcard");
    expect(html(s)).toContain("Your setup");
  });

  it("looking at a hex in setup changes nothing at all", () => {
    const s = setupSession();
    pickSpec(s, "armor:3");
    setMode(s, "remove");
    const before = JSON.stringify(s);
    lookAt(s, "M35");
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("the card from the first Player Turn", () => {
  it("lists the four Polish counters of Warsaw when it is tapped at the first Player Turn of 1939", () => {
    const s = inPlay();
    tapHex(s, hexOf(s, "M35"));
    expect(s.lookedAt).toBe("M35");
    const page = html(s);
    expect(page).toContain('class="hexcard"');
    expect(page).toContain("Warsaw (M35)");
    expect(page.match(/Polish infantry/g)).toHaveLength(2);
    expect(page.match(/Polish air/g)).toHaveLength(2);
    expect(page).toContain("does not defend");
    expect(page).toContain("4 counters");
    expect(page).not.toMatch(/\bu\d+\b/);
  });

  it("works on an empty hex and on a hex of the sea", () => {
    const s = inPlay();
    const sea = Object.values(s.ctx.map.hexes).find((h) => !h.land)!;
    tapHex(s, sea);
    expect(html(s)).toContain("Sea hex");
    tapHex(s, hexOf(s, "M34"));
    expect(html(s)).toContain("No counters here.");
  });

  it("moves to the next hex tapped, and closing it hides it until the next tap", () => {
    const s = inPlay();
    tapHex(s, hexOf(s, "M35"));
    tapHex(s, hexOf(s, "N33"));
    expect(cardFor(s)?.title).toBe("Lodz (N33)");
    closeLook(s);
    expect(cardFor(s)).toBeNull();
    expect(html(s)).not.toContain("hexcard");
    tapHex(s, hexOf(s, "N33"));
    expect(cardFor(s)?.title).toBe("Lodz (N33)");
  });

  it("has a close button of its own and is labelled by its heading", () => {
    const s = inPlay();
    tapHex(s, hexOf(s, "M35"));
    const page = html(s);
    expect(page).toContain('aria-labelledby="hexcard-title"');
    expect(page).toMatch(/<h2 id="hexcard-title" tabindex="-1">Warsaw \(M35\)<\/h2>/);
    expect(page).toMatch(/<button id="hexcard-close" type="button"/);
  });

  it("is a new start with a new session", () => {
    const s = inPlay();
    tapHex(s, hexOf(s, "M35"));
    expect(inPlay().lookedAt ?? null).toBeNull();
  });
});

describe("looking is passive", () => {
  it("leaves a stack chosen to move, and its yellow hexes, exactly as they were", () => {
    const s = inPlay();
    toStep(s, "6f");
    const m = movesNow(s)[0]!;
    const from = s.state.units[m.units[0]!]!.at;
    tapHex(s, hexOf(s, from));
    expect(s.moveChosen?.hex).toBe(from);
    const targets = moveTargets(s);
    expect(targets.length).toBeGreaterThan(0);
    const before = without(s);
    const state = s.state;
    for (const id of ["M35", "N33", "A1", ...Object.keys(s.ctx.map.hexes).slice(0, 40)]) {
      if (!s.ctx.map.hexes[id]) continue;
      lookAt(s, id);
      expect(s.lookedAt).toBe(id);
      expect(without(s)).toBe(before);
      expect(s.state).toBe(state);
      expect(moveTargets(s)).toEqual(targets);
    }
  });

  it("a real tap on an enemy hex while a stack is chosen keeps the choice (the move flow's own refusal) and still fills the card", () => {
    const s = inPlay();
    toStep(s, "6f");
    const from = s.state.units[movesNow(s)[0]!.units[0]!]!.at;
    tapHex(s, hexOf(s, from));
    const targets = moveTargets(s);
    tapHex(s, hexOf(s, "M35"));
    expect(s.lookedAt).toBe("M35");
    expect(s.moveChosen?.hex).toBe(from);
    expect(moveTargets(s)).toEqual(targets);
    expect(html(s)).toContain("Warsaw (M35)");
  });

  it("tapping your own stack selects it and lists it; tapping it again lets it go and the card stays", () => {
    const s = inPlay();
    toStep(s, "6f");
    const from = s.state.units[movesNow(s)[0]!.units[0]!]!.at;
    tapHex(s, hexOf(s, from));
    expect(s.moveChosen?.hex).toBe(from);
    expect(cardFor(s)?.hex).toBe(from);
    expect(cardFor(s)?.counters.length).toBeGreaterThan(0);
    tapHex(s, hexOf(s, from));
    expect(s.moveChosen ?? null).toBeNull();
    expect(cardFor(s)?.hex).toBe(from);
  });

  it("leaves a chosen build alone", () => {
    const s = inPlay();
    toStep(s, "8b");
    pickBuild(s, "germany:infantry:3");
    const build = s.build;
    expect(build).not.toBeNull();
    const before = without(s);
    lookAt(s, "M35");
    expect(without(s)).toBe(before);
    expect(s.build).toEqual(build);
    // a real tap on a hex that is no place for the build is refused by the build flow as before, and the choice stays
    tapHex(s, hexOf(s, "M35"));
    expect(s.build).toEqual(build);
    expect(s.toast).toMatch(/cannot be built there/);
    expect(cardFor(s)?.hex).toBe("M35");
  });

  it("never touches the game: the position, the log and the dice stay the same", () => {
    const s = inPlay();
    const { state, log } = s;
    const rng = s.state.rngState;
    for (const id of Object.keys(s.ctx.map.hexes).slice(0, 30)) lookAt(s, id);
    expect(s.state).toBe(state);
    expect(s.state.rngState).toBe(rng);
    expect(s.log).toBe(log);
  });
});

describe("the card with the computer or a watched game", () => {
  it("works while the computer is to move", () => {
    const s = inPlay();
    s.humanSide = "allies"; // the Axis are first: the computer plays them
    expect(computerToMove(s)).toBe(true);
    const before = JSON.stringify(s.state);
    tapHex(s, hexOf(s, "M35"));
    expect(html(s)).toContain("Warsaw (M35)");
    expect(JSON.stringify(s.state)).toBe(before);
  });

  it("works, read-only, while watching two computers", () => {
    const s = newWatchSession(SCENARIO_1939, 7, "slow", null);
    const state = s.state;
    tapHex(s, hexOf(s, "M35"));
    expect(s.state).toBe(state);
    expect(html(s)).toContain("Warsaw (M35)");
    expect(html(s)).toContain("Polish infantry");
  });
});
