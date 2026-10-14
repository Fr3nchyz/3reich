import { describe, expect, it } from "vitest";
import { recording } from "../scripts/selfplay/args";
import { runGame } from "../scripts/selfplay/runner";
import { TurnTally } from "../scripts/selfplay/stats";
import type { AnomalyKind } from "../scripts/selfplay/types";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { replay } from "../src/engine/actions";
import { turnKey } from "../src/engine/combat-record";
import { newGame } from "../src/engine/game";
import { computerSide, computerToMove } from "../src/ui/computerPlay";
import type { Session } from "../src/ui/session";
import { panelHtml, statusLine } from "../src/ui/watchBar";
import { beginStep, markStuck, pause, shouldRun, type StuckKind } from "../src/ui/watchController";
import { newWatchSession, recordFor, watchSlice } from "../src/ui/watchPlay";
import { summarise } from "../src/ui/watchSummary";

/** What the watch mode shares with the self-play runner (docs/SELFPLAY.md): record format, anomaly names, End of game counts; and the acting side. */

const fresh = (turns: number | null = null): Session => newWatchSession(SCENARIO_1939, 7, "turbo", turns);
const slices = (s: Session, n: number): void => {
  let t = 0;
  for (let i = 0; i < n && shouldRun(s.watch!, s.state); i++) watchSlice(s, () => (t += 10));
};

describe("the acting side (Ref 12.2: whoever owns the units that lose chooses the losses)", () => {
  it("is the side whose Player Turn it is, except while an Exchange waits for the other side to choose its losses", () => {
    const s = fresh();
    expect(computerSide(s)).toBe(s.state.activeSide);
    const other = s.state.activeSide === "axis" ? "allies" : "axis";
    s.state = { ...s.state, combat: { turn: turnKey(s.state), attacked: [], targets: [], advances: [], pending: { chooser: other, target: "M35", candidates: [], values: {}, required: 1, attackers: [] } } };
    expect(computerSide(s)).toBe(other);
    expect(computerToMove(s)).toBe(true);
    expect(statusLine(s)).toContain(`${other === "axis" ? "Axis" : "Allied"} acting`);
  });
});

describe("the saved record against the self-play runner's", () => {
  it("has the same keys as the runner's recording, and anomaly kinds the runner uses", () => {
    const s = fresh(1);
    slices(s, 3);
    s.watch = markStuck(s.watch!, "refused", "x");
    const run = runGame({ scenario: "1939", seed: 7, turns: 1 });
    expect(Object.keys(recordFor(s)).sort()).toEqual(Object.keys(recording(run)).sort());
    expect(recordFor(s).anomalies[0]).toEqual({ kind: "refused", at: expect.any(String) as string, detail: "x" });
    // Compile-time: every kind the watch mode records is one of the runner's anomaly kinds.
    const kinds: AnomalyKind[] = (["setup", "stuck", "refused", "exception", "no-progress", "turn-budget"] satisfies StuckKind[]);
    expect(kinds).toHaveLength(6);
  }, 60_000);

  it("replays to exactly the live position, even when saved in the middle of a step", () => {
    const s = fresh();
    slices(s, 4);
    s.watch = beginStep(pause(s.watch!), "action", s.state);
    watchSlice(s);
    const saved = JSON.parse(JSON.stringify(recordFor(s))) as ReturnType<typeof recordFor>;
    expect(saved.ended).toBe("stopped");
    const again = replay(s.ctx, newGame(SCENARIO_1939, saved.seed), saved.actions);
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(s.state));
  }, 60_000);
});

describe("the End of game numbers against the self-play report's", () => {
  it("count hexes and counters the same way", () => {
    const s = fresh();
    slices(s, 6);
    const sum = summarise(s.ctx, s.state);
    const report = new TurnTally("x").close(s.ctx, s.state, false);
    expect(sum.hexes).toEqual(report.hexes);
    expect(sum.units).toEqual(report.units);
    for (const [id, n] of Object.entries(report.brp)) expect(sum.brps[id as keyof typeof sum.brps]).toBe(n);
  }, 60_000);
});

describe("take over at the end", () => {
  it("is offered after the chosen Game Turn limit, not after the end of the scenario", () => {
    const limited = fresh(1);
    for (let i = 0; i < 400 && shouldRun(limited.watch!, limited.state); i++) watchSlice(limited);
    expect(panelHtml(limited)).toMatch(/id="w-take-axis" type="button" >/);
    const over = fresh();
    over.state = { ...over.state, phase: "game-over" };
    expect(panelHtml(over)).toMatch(/id="w-take-axis" type="button" disabled>/);
  }, 60_000);
});
