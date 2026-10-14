import { describe, expect, it } from "vitest";
import { replay, type Action } from "../src/engine/actions";
import { chooseAction } from "../src/ai";
import { newGame } from "../src/engine/game";
import type { GameState } from "../src/engine/types";
import { parseArgs, recording } from "../scripts/selfplay/args";
import { comparison, gameReport } from "../scripts/selfplay/report";
import { auditState, runGame } from "../scripts/selfplay/runner";
import { SCENARIOS, SCENARIO_KEYS } from "../scripts/selfplay/scenarios";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

// The headless self-play runner (docs/SELFPLAY.md): the computer on both sides through the engine's own actions.
// Short games only; the long runs are `npm run selfplay`.

describe("self-play runner: a short game per scenario", () => {
  for (const key of SCENARIO_KEYS) {
    it(`${key}: runs 1 Game Turn with no anomaly, and the recording replays to the identical final state`, () => {
      const r = runGame({ scenario: key, seed: 3, turns: 1 });
      expect(r.anomalies).toEqual([]);
      expect(r.ended).toBe("turn-limit");
      expect(r.turns).toHaveLength(1);
      expect(r.actions.length).toBeGreaterThan(r.setupActions);
      // The recorded list goes through JSON and back, as a file would, then replays from the new game.
      const saved = JSON.parse(JSON.stringify(recording(r))) as ReturnType<typeof recording>;
      const again = replay(r.ctx, newGame(SCENARIOS[saved.scenario], saved.seed), saved.actions);
      expect(JSON.stringify(again.state)).toBe(JSON.stringify(r.final));
    }, 60_000);
  }

  it("is deterministic per seed and differs between seeds", () => {
    const a = runGame({ scenario: "1939", seed: 5, turns: 2 });
    const b = runGame({ scenario: "1939", seed: 5, turns: 2 });
    expect(b.actions).toEqual(a.actions);
    expect(gameReport(b)).toBe(gameReport(a));
    expect(runGame({ scenario: "1939", seed: 6, turns: 2 }).actions).not.toEqual(a.actions);
  }, 60_000);

  it("plays to the end of the scenario with 'end' and reports it (the 1944 scenario cut to its first Game Turn)", () => {
    const r = runGame({ scenario: "1944", seed: 1, turns: "end" }, { scenario: { ...SCENARIOS["1944"], end: SCENARIOS["1944"].start } });
    expect(r.ended).toBe("game-over");
    expect(r.final.phase).toBe("game-over");
    expect(r.anomalies).toEqual([]);
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0]!.partial).toBe(false);
  }, 60_000);
});

describe("self-play report", () => {
  const r = runGame({ scenario: "1939", seed: 1, turns: 2 });
  it("lists per Game Turn the BRPs, spending, wars, builds, grants, combats, control, units and Front Options, then a summary and the anomalies", () => {
    const md = gameReport(r);
    for (const part of ["## Summary", "## Anomalies", "### Economy", "### Activity", "### Map and forces", "Wars declared", "Built", "Grants", "Combats", "Hexes", "Units", "Front Options", "Fall 1939", "Winter 1939"]) expect(md).toContain(part);
    expect(md).toContain("None.");
    expect(r.turns[0]!.built).toBeGreaterThan(0);
    expect(r.turns[0]!.hexes.axis + r.turns[0]!.hexes.allies + r.turns[0]!.hexes.neutral).toBeGreaterThan(300);
  });

  it("the numbers add up to the events of the recorded game", () => {
    const events = replay(r.ctx, r.initial, r.actions).events;
    const count = (type: string) => events.filter((e) => e.type === type).length;
    const sum = (f: (t: (typeof r.turns)[number]) => number) => r.turns.reduce((n, t) => n + f(t), 0);
    expect(sum((t) => t.hexChanges)).toBe(count("HEX_CONTROL_CHANGED"));
    expect(sum((t) => t.combats.total)).toBe(count("COMBAT_RESOLVED"));
    expect(sum((t) => t.built)).toBe(count("UNIT_BUILT"));
    expect(sum((t) => t.moves)).toBe(count("UNITS_MOVED"));
    expect(sum((t) => t.lost.axis + t.lost.allies)).toBe(count("UNIT_ELIMINATED"));
    expect(sum((t) => t.wars.length)).toBe(count("WAR_DECLARED"));
    expect(sum((t) => t.actions)).toBe(r.actions.length - r.setupActions);
    expect(sum((t) => t.hexChanges)).toBeGreaterThan(0);
  });

  it("the comparison has a row per game and the runtime", () => {
    const page = comparison([r, runGame({ scenario: "campaign", seed: 1, turns: 1 })]);
    expect(page.match(/^\| (1939|campaign) \|/gm)).toHaveLength(2);
    expect(page).toMatch(/Runtime s/);
    expect(page).toMatch(/2 games, [\d.]+ s in all, 0 anomalies/);
  }, 60_000);
});

describe("self-play anomalies are detected, not looped on", () => {
  it("a computer with no action is reported as stuck", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1 }, { choose: () => null });
    expect(r.anomalies.map((a) => a.kind)).toEqual(["stuck"]);
    expect(r.ended).toBe("stopped");
  });

  it("an action the engine refuses is reported, with the reason, and the run stops", () => {
    const bad: Action = { type: "GRANT_BRPS", from: "germany", to: "germany", amount: 1 };
    const r = runGame({ scenario: "1939", seed: 1, turns: 1 }, { choose: () => ({ action: bad, why: "test" }) });
    expect(r.anomalies[0]).toMatchObject({ kind: "illegal-choice" });
    expect(r.anomalies.some((a) => a.kind === "refused")).toBe(true);
  });

  it("a chooser that throws is reported", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1 }, { choose: () => { throw new Error("boom"); } });
    expect(r.anomalies).toMatchObject([{ kind: "exception", detail: "boom" }]);
  });

  it("a step that never advances is stopped at the step limit", () => {
    // At step 8b the computer builds many units; a limit of 2 actions per step must report it rather than go on.
    const r = runGame({ scenario: "1939", seed: 1, turns: 1, stepLimit: 2 });
    expect(r.anomalies.some((a) => a.kind === "no-progress")).toBe(true);
  });

  it("a Game Turn that takes too many actions is stopped at the turn budget", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1, turnLimit: 5 });
    expect(r.anomalies.some((a) => a.kind === "turn-budget")).toBe(true);
  });

  it("a choice that is not on the legal list is reported even when the engine would accept it", () => {
    // Ending step 1 at step 1 is legal; asking the chooser for a stale END_STEP of another step is refused by the engine and flagged.
    const stale = (ctx: Parameters<typeof chooseAction>[0], s: GameState, cfg: Parameters<typeof chooseAction>[2]) => {
      const d = chooseAction(ctx, s, cfg);
      return d && d.action.type === "END_STEP" ? { ...d, action: { ...d.action, step: "zz" } } : d;
    };
    const r = runGame({ scenario: "1939", seed: 1, turns: 1 }, { choose: stale });
    expect(r.anomalies.map((a) => a.kind)).toEqual(expect.arrayContaining(["illegal-choice", "refused"]));
  });

  it("auditState finds negative BRPs and overstacked hexes, and checks stacking only when a Player Turn has ended", () => {
    const s = at6f([inf("a", "germany", "L32"), inf("b", "germany", "L32"), inf("c", "germany", "L32"), inf("d", "germany", "L32"), inf("e", "germany", "L32")]);
    expect(auditState(CTX, s, true).some((p) => p.kind === "overstack" && /L32/.test(p.detail))).toBe(true);
    expect(auditState(CTX, s, false)).toEqual([]);
    const poor: GameState = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal: -3 } } };
    expect(auditState(CTX, poor, false)).toEqual([{ kind: "negative-brp", detail: "germany has -3 BRPs" }]);
  });
});

describe("self-play command line", () => {
  it("parses the options and their defaults", () => {
    expect(parseArgs(["--scenario", "1942", "--turns", "end", "--seed", "7", "--games", "3", "--out", "x"])).toEqual({ scenarios: ["1942"], turns: "end", seed: 7, games: 3, out: "x", verify: true });
    expect(parseArgs([]).scenarios).toEqual(["1939"]);
    expect(parseArgs(["--scenario", "all"]).scenarios).toEqual([...SCENARIO_KEYS]);
    expect(parseArgs(["--no-verify"]).verify).toBe(false);
  });

  it("refuses what it does not understand", () => {
    for (const bad of [["--scenario", "1941"], ["--turns", "0"], ["--turns", "x"], ["--seed", "-1"], ["--games", "0"], ["--bogus"], ["--out"]]) expect(() => parseArgs(bad), bad.join(" ")).toThrow(/usage/);
  });
});
