import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { newGame } from "../src/engine/game";
import { objectiveStandings } from "../src/engine/objectives";
import { objectiveMarksMarkup } from "../src/ui/mapCities";
import { objectivesCard, scoreHtml } from "../src/ui/objectivesCard";
import { newSession } from "../src/ui/session";
import { statusHtml } from "../src/ui/statusView";
import { ctxFor } from "./helpers";
import { withCounts } from "./helpers-victory";

// Spec 14 part D1 (ticket 14-4): the score line, the "Victory and objectives" card and the marks on the map. Ref 2.0: 42 Objectives, 14 a Front.

describe("the Objectives card model", () => {
  const card = objectivesCard(ctxFor(), newGame(SCENARIO_1939, 1));
  it("lists the 42 Objectives, 14 on each Front, by name, with who holds each", () => {
    expect(card.fronts.map((f) => f.title)).toEqual(["Western Front (14)", "Eastern Front (14)", "Mediterranean Front (14)"]);
    for (const f of card.fronts) {
      expect(f.rows).toHaveLength(14);
      expect(f.rows.map((r) => r.name)).toEqual([...f.rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b)));
    }
    const rows = card.fronts.flatMap((f) => f.rows);
    expect(rows.find((r) => r.name === "Berlin")!.holder).toBe("Axis");
    expect(rows.find((r) => r.name === "Moscow")!.holder).toBe("Allies");
    expect(rows.find((r) => r.name === "Antwerp")!.holder).toBe("nobody");
  });
  it("the counts are the standings", () => {
    expect(card.score).toBe("Objectives held: Axis 9, Allies 23, nobody 10");
    const s = objectiveStandings(ctxFor(), newGame(SCENARIO_1939, 1));
    expect(card.fronts.flatMap((f) => f.rows).filter((r) => r.holder === "Axis")).toHaveLength(s.axis.length);
  });
  it("says whether the Free Siberian Transfer is in use, and what each side needs", () => {
    expect(card.siberian).toBe("Free Siberian Transfer: not used.");
    expect(card.needs[0]).toBe("Allies: 15 = Marginal, 16 = Tactical, 17 = Decisive");
    const used = objectivesCard(ctxFor(), { ...newGame(SCENARIO_1939, 1), siberian: { used: true, taken: {} } });
    expect(used.siberian).toMatch(/in use/);
    expect(used.needs[0]).toBe("Allies: 16 = Marginal, 17 = Tactical, 18 = Decisive");
  });
  it("follows the game: a changed hand moves a row and the count", () => {
    const c = objectivesCard(ctxFor(), withCounts(SCENARIO_1939, 20, 22));
    expect(c.score).toBe("Objectives held: Axis 22, Allies 20, nobody 0");
  });
});

describe("the score line and the card in the status area", () => {
  it("shows the line and the button during play, nothing during setup", () => {
    const s = newSession(SCENARIO_1939, "axis", 1);
    expect(scoreHtml(s)).toBe("");
    const playing = { ...s, state: { ...s.state, phase: "player-turn" as const } };
    const html = scoreHtml(playing);
    expect(html).toContain("Objectives held: Axis 9, Allies 23, nobody 10");
    expect(html).toContain("Victory and objectives");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="obj-card"');
  });
  it("opens the card: a labelled section, a close button, one button per Objective, each at least a button of its own", () => {
    const s = { ...newSession(SCENARIO_1942, "axis", 1), objectivesOpen: true };
    const html = statusHtml({ ...s, state: { ...s.state, phase: "player-turn" } }, null, []);
    expect(html).toContain('aria-labelledby="obj-title"');
    expect(html).toContain('id="obj-close"');
    expect(html.match(/data-objhex=/g)).toHaveLength(42);
    expect(html).toContain("On the map: a square");
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\b[A-Z]{1,2}\d{1,2}\b/);
  });
  it("after a game ends and the result card is put away, a button brings it back", () => {
    const s = newSession(SCENARIO_1944, "axis", 1);
    const result = { winner: "axis" as const, level: "decisive" as const, basis: "turn-limit" as const, objectives: { axis: 22, allies: 17, nobody: 3 }, at: { year: 1946, season: "spring" as const }, early: false, siberian: false };
    const done = { ...s, state: { ...s.state, phase: "game-over" as const, result } };
    expect(scoreHtml(done)).not.toContain("end-show");
    expect(scoreHtml({ ...done, endDismissed: true })).toContain('id="end-show"');
  });
});

describe("the marks on the map (D1: a square for the Axis, a circle for the Allies, a dashed ring for nobody)", () => {
  const standings = objectiveStandings(ctxFor(SCENARIO_1939), newGame(SCENARIO_1939, 1));
  const svg = objectiveMarksMarkup(MAP, standings);
  it("has one mark per Objective, by holder, with a different shape for each", () => {
    expect(svg.match(/<rect /g)).toHaveLength(9);
    expect(svg.match(/class="obj-mark allies"/g)).toHaveLength(23);
    expect(svg.match(/class="obj-mark nobody"/g)).toHaveLength(10);
    expect(svg.match(/<rect class="obj-mark axis"/g)).toHaveLength(9);
    expect(svg.match(/<circle /g)).toHaveLength(33);
  });
  it("names the hex and the holder in data attributes, and marks the right hex", () => {
    expect(svg).toContain('data-objective="L31" data-holder="axis"'); // Berlin
    const antwerp = Object.values(MAP.hexes).find((h) => h.name === "Antwerp")!.id;
    expect(svg).toContain(`data-objective="${antwerp}" data-holder="nobody"`);
  });
  it("is empty for no standings, and follows a change of hand", () => {
    expect(objectiveMarksMarkup(MAP, null)).toBe("");
    const moved = objectiveMarksMarkup(MAP, objectiveStandings(ctxFor(SCENARIO_1939), withCounts(SCENARIO_1939, 20, 22)));
    expect(moved.match(/data-holder="allies"/g)).toHaveLength(20);
    expect(moved.match(/data-holder="nobody"/g)).toBeNull();
  });
});
