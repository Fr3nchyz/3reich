import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { createSession, setupView, type Session } from "../src/ui/session";
import { fillRest, finishOwner, takeAction } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";

/** The status area during play: where the game stands, declarations of war, and what the log says. */

function inPlay(): Session {
  const s = createSession(SCENARIO_1939, "axis", 1);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) finishOwner(s, v.owner);
  }
  expect(s.state.phase).toBe("player-turn");
  return s;
}

describe("the counter chips in setup", () => {
  it("show each counter's drawn symbol and numbers, never a text glyph that a font may draw as a blank box", () => {
    const s = createSession(SCENARIO_1939, "axis", 1);
    const html = statusHtml(s, setupView(s), legalActions(s.ctx, s.state));
    const chips = [...html.matchAll(/<button data-spec="([^"]+)"[^>]*>(.*?)<\/button>/g)];
    expect(chips.length).toBeGreaterThan(2);
    for (const [, , inner] of chips) {
      expect(inner).toContain('<svg class="icon"');
      expect(inner).not.toMatch(/[▭⌃✈⚓]/);
    }
    // The armor chip carries the armor symbol (a box with an oval) and its numbers.
    const armor = chips.find(([, key]) => key!.startsWith("armor:"));
    expect(armor?.[2]).toContain("<ellipse");
    expect(armor?.[2]).toMatch(/\d+-\d+/);
  });
});

describe("the status area in play", () => {
  it("names the step and offers declarations of war in a fold-out, then the button that moves on", () => {
    const s = inPlay();
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("step 1 (Make Declarations of War");
    expect(html).toMatch(/<summary>Declare war \(\d+ choices\)<\/summary>/);
    expect(html).toContain("Germany declares war on Norway (10 BRPs)");
    expect(html).toContain("Germany declares war on Soviet Union (35 BRPs)");
    expect(html).toContain("Done with step 1");
    expect(html).toContain("0 of 75 spent");
  });

  it("logs a declaration with its cost and shows what is left of the limit", () => {
    const s = inPlay();
    takeAction(s, { type: "DECLARE_WAR", by: "germany", on: "norway" });
    expect(s.toast).toBe("");
    expect(s.log.at(-2)).toBe("Germany: -10 BRPs (declaring war on Norway), 140 left.");
    expect(s.log.at(-1)).toBe("Germany declares war on Norway (10 BRPs).");
    expect(statusHtml(s, null, legalActions(s.ctx, s.state))).toContain("10 of 75 spent");
  });

  it("keeps the declarations open while you make several, and closed otherwise", () => {
    const s = inPlay();
    expect(statusHtml(s, null, legalActions(s.ctx, s.state))).toMatch(/<details class="declarations">/);
    takeAction(s, { type: "DECLARE_WAR", by: "germany", on: "norway" });
    expect(statusHtml(s, null, legalActions(s.ctx, s.state))).toMatch(/<details class="declarations" open>/);
    takeAction(s, { type: "DECLARE_WAR", by: "germany", on: "denmark" });
    expect(statusHtml(s, null, legalActions(s.ctx, s.state))).toMatch(/<details class="declarations" open>/);
  });

  it("puts a refusal in the toast", () => {
    const s = inPlay();
    takeAction(s, { type: "DECLARE_WAR", by: "germany", on: "poland" });
    expect(s.toast).toMatch(/already at war/);
  });

  it("shows only the move-on button once the steps with something to do are done", () => {
    const s = inPlay();
    for (const step of ["1", "3", "6f", "8b"]) takeAction(s, { type: "END_STEP", side: "axis", step });
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("step 10b (Save-Game prompt)");
    expect(html).not.toContain("Declare war");
    expect(html).toContain("End Axis turn");
  });
});

describe("the Front Options prompt at step 3 (Ref 11.21)", () => {
  function atStep3(): Session {
    const s = inPlay();
    takeAction(s, { type: "END_STEP", side: "axis", step: "1" });
    expect(s.state.position).toMatchObject({ step: "3" });
    return s;
  }

  it("asks for an Option per Front, with the cost, and lists the choices in a fold-out above the move-on button", () => {
    const s = atStep3();
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("Front Options (step 3)");
    expect(html).toMatch(/<summary>Choose a Front Option \(\d+ choices\)/);
    expect(html).toContain("Western Front: Offensive Option (15 BRPs from Germany)");
    expect(html).toContain("Eastern Front: Offensive Option</button>"); // Germany's opening one is free (Ref 29.0)
    expect(html).toContain("Done with step 3");
  });

  it("logs a choice, keeps the fold-out open and shows what is chosen", () => {
    const s = atStep3();
    takeAction(s, { type: "SELECT_FRONT_OPTION", side: "axis", front: "western", option: "attrition" });
    expect(s.log.at(-1)).toBe("Axis choose the Attrition Option on the Western Front.");
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("Chosen so far &mdash; Western: attrition");
    expect(html).toMatch(/<details class="declarations" open>/);
    expect(html).not.toContain("Western Front: Defensive Option");
  });

  it("is not shown at other steps", () => {
    const s = inPlay();
    expect(statusHtml(s, null, legalActions(s.ctx, s.state))).not.toContain("Front Options (step 3)");
  });
});
