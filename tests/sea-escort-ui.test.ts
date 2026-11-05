import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { markUsed, useOf } from "../src/engine/naval-record";
import { srOf } from "../src/engine/sr-record";
import { newSession } from "../src/ui/session";
import { chooseEscort, chooseStack, confirmRedeploy, pickDestination, redeployTargets } from "../src/ui/redeployTap";
import { panelOf, whyNot } from "../src/ui/redeployModel";
import { redeployHtml } from "../src/ui/redeployView";
import { takeBackRedeploy } from "../src/ui/redeployUndo";
import { board, counter } from "./board";

function session() {
  const s = newSession(SCENARIO_1939, "allies", 1);
  s.state = board([
    counter("g", "britain", "replacement", 1, "L22"),
    counter("f1", "britain", "fleet", 9, "L22"), counter("f2", "britain", "fleet", 9, "K24"),
    counter("other", "britain", "infantry", 2, "J24", 3),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 2, step: "9e" } });
  return s;
}

// Spec 16 D4/D6, R22: UI offers the engine's receiving ports and fleet choices, and sends exactly one escorted counter.
describe("Sea Escort panel, spec 16 R22", () => {
  it("selects a receiving port and another offered escort, then records and takes back the action", () => {
    const s = session();
    expect(chooseStack(s, "L22")).toBe(true);
    expect(redeployTargets(s)).toContain("M21");
    pickDestination(s, "M21");
    expect(s.redeploy?.escort).toBe("f1");
    const html = redeployHtml(s, []);
    expect(html).toContain('data-srescort="f1"');
    expect(html).toContain('data-srescort="f2"');
    expect(html).toContain("used for this Game Turn");
    chooseEscort(s, "missing");
    expect(s.redeploy?.escort).toBe("f1");
    chooseEscort(s, "f2");
    confirmRedeploy(s);
    expect(s.state.units.g!.at).toBe("M21");
    expect(useOf(s.state, "f2")).toBe("escort");
    expect(s.record.at(-1)).toMatchObject({ type: "SR_UNITS", escort: "f2", units: ["g"] });
    expect(takeBackRedeploy(s)).toBe(true);
    expect(s.state.units.g!.at).toBe("L22");
    expect(useOf(s.state, "f2")).toBeUndefined();
    expect(srOf(s.state).used).toEqual({});
  });

  it("explains a missing free escort and keeps a land destination free of escort use", () => {
    const s = session();
    s.state = markUsed(s.state, ["f1", "f2"], "supply");
    expect(whyNot(s.ctx, s.state, ["g"], "M21")).toContain("Needs a Sea Escort and none is free");
    chooseStack(s, "L22");
    expect(redeployTargets(s)).not.toContain("M21");
    pickDestination(s, "J24");
    expect(s.redeploy?.escort).toBeUndefined();
    confirmRedeploy(s);
    expect(s.state.units.g!.at).toBe("J24");
    expect(useOf(s.state, "f1")).toBe("supply");
  });

  it("shows the no-free-escort note for a unit isolated on an island", () => {
    const s = session();
    s.state = { ...s.state, units: { g: { ...s.state.units.g!, at: "GG19" } }, control: { GG19: "britain" } };
    expect(panelOf(s.ctx, s.state).stacks[0]!.lines[0]!.note).toContain("Needs a Sea Escort and none is free");
  });
});
