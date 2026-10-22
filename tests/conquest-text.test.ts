import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameEvent } from "../src/engine/actions";
import { conquestLine } from "../src/ui/conquestText";
import { eventSide } from "../src/ui/logSide";
import { createSession, run } from "../src/ui/session";
import { statusHtml } from "../src/ui/statusView";
import { gameOverLine } from "../src/ui/victoryLine";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 14 ticket 14-5: the engine's conquest events have a minimal log line each (the banner and the cards of D3 come with a later screen ticket).

describe("the log lines of a conquest", () => {
  const lost: GameEvent = { type: "CAPITAL_LOST", power: "germany", capital: "L31", by: "britain" };
  it("the warning names the capital (as every other log line names a place) and the Power in words", () => {
    expect(conquestLine(CTX, lost)).toBe("Berlin (L31) has been taken. Germany falls at the end of its own Combat Phase unless it takes Berlin (L31) back.");
  });
  it("the retaking and the fall", () => {
    expect(conquestLine(CTX, { type: "CAPITAL_RETAKEN", power: "germany", capital: "L31" })).toBe("Germany has taken back Berlin (L31).");
    expect(conquestLine(CTX, { type: "COUNTRY_CONQUERED", country: "germany", by: "britain", how: "capital", unitsRemoved: 40, hexesPassed: 54 })).toBe("Germany has been conquered by Great Britain: 40 units leave the game and 54 hexes change hands.");
    expect(conquestLine(CTX, { type: "COUNTRY_CONQUERED", country: "italy", by: "britain", how: "capital", unitsRemoved: 1, hexesPassed: 1 })).toContain("1 unit leaves the game and 1 hex changes hands");
  });
  it("the units and the land passed say nothing of their own: the fall's line has the numbers", () => {
    expect(conquestLine(CTX, { type: "UNITS_REMOVED_BY_CONQUEST", country: "germany", units: [] })).toBeNull();
    expect(conquestLine(CTX, { type: "CONTROL_PASSED", country: "germany", to: null, hexes: ["M35"] })).toBeNull();
  });
  it("the colour of a line is the side of the Power that lost: red for Germany, blue for Britain; the fall takes the side opposite its conqueror", () => {
    expect(eventSide(lost, "allies")).toBe("axis");
    expect(eventSide({ type: "CAPITAL_RETAKEN", power: "britain", capital: "K23" }, "axis")).toBe("allies");
    expect(eventSide({ type: "COUNTRY_CONQUERED", country: "germany", by: "britain", how: "capital", unitsRemoved: 0, hexesPassed: 0 }, "allies")).toBe("axis");
    expect(eventSide({ type: "COUNTRY_CONQUERED", country: "britain", by: "germany", how: "capital", unitsRemoved: 0, hexesPassed: 0 }, "axis")).toBe("allies");
  });
});

describe("the end of the game in the log", () => {
  const result = { winner: "allies", level: "tactical", basis: "conquest", objectives: { axis: 9, allies: 23, nobody: 10 }, at: { year: 1945, season: "spring" }, early: true, siberian: false } as const;
  it("an early end says a conquest decided it; the end of the scenario keeps its wording", () => {
    expect(gameOverLine("spring", 1945, result)).toBe("The game ends in Spring 1945: a conquest decided it. Allied Tactical Victory. Objectives held: Axis 9, Allies 23, nobody 10.");
    expect(gameOverLine("summer", 1942, { ...result, early: false })).toBe("The scenario ends after Summer 1942. Allied Tactical Victory. Objectives held: Axis 9, Allies 23, nobody 10.");
  });
});

describe("the session and the nation table", () => {
  it("run() logs the fall in the colour of the Power that lost, and the table shows the status as Conquered with 0 BRPs", () => {
    const s = createSession(SCENARIO_1939, "allies", 1);
    s.state = board([counter("b1", "britain", "infantry", 3, "L31", 3), counter("g1", "germany", "infantry", 3, "L33", 3)], SCENARIO_1939, {
      control: { L31: "britain" }, year: 1940, season: "spring", firstSide: "axis", activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7p" },
    });
    expect(run(s, { type: "END_STEP", side: "axis", step: "7p" })).toBe(true);
    const i = s.log.findIndex((l) => l.startsWith("Germany has been conquered by Great Britain: 1 unit leaves the game"));
    expect(i).toBeGreaterThan(-1);
    expect(s.logSides?.get(i)).toBe("axis");
    expect(statusHtml(s, null, [])).toMatch(/<td>Germany<\/td><td>Conquered<\/td><td>0<\/td>/);
  });
});
