import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { legalActions } from "../src/engine/actions";
import { buildKey, buildOptions, buildPanel } from "../src/ui/buildView";
import { createSession, setupView, type Session } from "../src/ui/session";
import { buildInBox, builds, fillRest, normaliseMode, pickBuild, takeAction, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";

/** Step 8b in the browser: the construction panel, choosing a counter, tapping a hex or a box button; grants in a fold-out. */

function inPlay(scenario = SCENARIO_1939, side: "axis" | "allies" = "axis"): Session {
  const s = createSession(scenario, side, 1);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) takeAction(s, { type: "SETUP_DONE", owner: v.owner });
  }
  expect(s.state.phase).toBe("player-turn");
  return s;
}
const toStep = (s: Session, step: string) => {
  for (let i = 0; i < 12 && !(s.state.position?.part === "player-turn" && s.state.position.step === step); i++) {
    const last = legalActions(s.ctx, s.state).at(-1)!;
    takeAction(s, last);
  }
  expect(s.state.position).toMatchObject({ step });
};

describe("the construction panel", () => {
  it("lists what Germany may build with its cost, and says what to do", () => {
    const s = inPlay();
    toStep(s, "8b");
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("<h2>Construction</h2>");
    expect(html).toContain("Pick a counter to build");
    expect(html).toMatch(/data-build="germany:infantry:3"/);
    expect(html).toContain("Germany &middot; 3 BRPs"); // a 3-factor infantry
    expect(html).toContain("Germany &middot; 27 BRPs"); // a 9-factor fleet
    expect(html).toContain("<svg class=\"icon\"");
    expect(html).not.toContain(">BUILD<");
    expect(html).toContain("Done with step 8b");
  });

  it("is not shown at other steps", () => {
    const s = inPlay();
    expect(buildPanel(s, legalActions(s.ctx, s.state))).toBe("");
    expect(statusHtml(s, null, legalActions(s.ctx, s.state))).not.toContain("Construction");
  });

  it("groups the legal builds into one option per counter, each with its places", () => {
    const s = inPlay();
    toStep(s, "8b");
    const options = buildOptions(legalActions(s.ctx, s.state));
    expect(options.map(buildKey)).toEqual(expect.arrayContaining(["germany:infantry:3", "germany:armor:4", "germany:fleet:9"]));
    for (const o of options) expect(o.places.length).toBeGreaterThan(0);
    expect(options.find((o) => o.type === "fleet")!.cost).toBe(27);
  });
});

describe("choosing and tapping", () => {
  it("a chosen counter outlines its places, a tap on one builds it, and the log says so", () => {
    const s = inPlay();
    toStep(s, "8b");
    pickBuild(s, "germany:infantry:3");
    const at = builds(s).find((a) => a.unit.type === "infantry" && a.unit.strength === 3)!.at;
    const before = Object.keys(s.state.units).length;
    tapHex(s, MAP.hexes[at]!);
    expect(s.toast).toBe("");
    expect(Object.keys(s.state.units)).toHaveLength(before + 1);
    expect(s.log.at(-1)).toBe(`Germany builds a 3-factor infantry at ${at} (3 BRPs).`);
    expect(s.state.nations.germany.spent).toBe(3);
  });

  it("a tap on a hex that is not a place for it says so and builds nothing", () => {
    const s = inPlay();
    toStep(s, "8b");
    pickBuild(s, "germany:infantry:3");
    const poland = Object.values(MAP.hexes).find((h) => h.land && h.country === "poland")!;
    const before = Object.keys(s.state.units).length;
    tapHex(s, poland);
    expect(s.toast).toMatch(/cannot be built there/);
    expect(Object.keys(s.state.units)).toHaveLength(before);
  });

  it("a tap with nothing chosen does nothing", () => {
    const s = inPlay();
    toStep(s, "8b");
    const before = Object.keys(s.state.units).length;
    tapHex(s, Object.values(MAP.hexes).find((h) => h.land && h.country === "germany")!);
    expect(Object.keys(s.state.units)).toHaveLength(before);
  });

  it("the choice is dropped when the step is left", () => {
    const s = inPlay();
    toStep(s, "8b");
    pickBuild(s, "germany:infantry:3");
    takeAction(s, { type: "END_STEP", side: "axis", step: "8b" });
    normaliseMode(s);
    expect(s.build).toBeNull();
  });

  it("the U.S. builds in the U.S. Box with a button, not on the map", () => {
    const s = inPlay(SCENARIO_1942, "allies");
    // Move the game to the Allied turn's step 8b by moving on through the Axis turn and the Allied steps before it.
    for (let i = 0; i < 30 && !(s.state.activeSide === "allies" && s.state.position?.part === "player-turn" && s.state.position.step === "8b"); i++) {
      takeAction(s, legalActions(s.ctx, s.state).at(-1)!);
    }
    expect(s.state.activeSide).toBe("allies");
    pickBuild(s, "usa:infantry:3");
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("This counter is built in the U.S. Box");
    expect(html).toContain('data-buildbox="us-box"');
    const before = Object.keys(s.state.units).length;
    buildInBox(s, "us-box");
    expect(Object.keys(s.state.units)).toHaveLength(before + 1);
    expect(s.log.at(-1)).toContain("United States builds a 3-factor infantry at us-box");
  });
});

describe("grants in the status area", () => {
  it("offer a fold-out of grants at step 9a, and a grant is logged", () => {
    const s = inPlay(SCENARIO_1942, "allies");
    for (let i = 0; i < 30 && !(s.state.activeSide === "allies" && s.state.position?.part === "player-turn" && s.state.position.step === "9a"); i++) {
      takeAction(s, legalActions(s.ctx, s.state).at(-1)!);
    }
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toMatch(/<summary>Grant BRPs \(\d+ choices\)<\/summary>/);
    expect(html).toContain("Great Britain grants 10 BRPs to Soviet Union");
    takeAction(s, { type: "GRANT_BRPS", from: "britain", to: "ussr", amount: 10 });
    expect(s.toast).toBe("");
    expect(s.log.at(-1)).toBe("Great Britain grants 10 BRPs to Soviet Union.");
    expect(statusHtml(s, null, legalActions(s.ctx, s.state))).toMatch(/<details class="declarations" open>/);
  });
});
