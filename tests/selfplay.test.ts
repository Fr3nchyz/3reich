import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, replay, type Action, type GameEvent } from "../src/engine/actions";
import { controllerOf, sideInWar } from "../src/engine/control";
import { sideOfOwner } from "../src/engine/setup";
import { chooseAction } from "../src/ai";
import { newGame } from "../src/engine/game";
import { SUPPLY_EFFECTS_ENABLED } from "../src/engine/supply-effects";
import type { GameState } from "../src/engine/types";
import { MAX_SEED, parseArgs, recording, recordingContext } from "../scripts/selfplay/args";
import { prepareOut } from "../scripts/selfplay/out";
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
      const again = replay(recordingContext(saved), newGame(SCENARIOS[saved.scenario], saved.seed), saved.actions);
      expect(JSON.stringify(again.state)).toBe(JSON.stringify(r.final));
    }, 60_000);
  }

  it("a recording made with the supply effects on says so, and replays in a context with them on to the identical final state", () => {
    const r = runGame({ scenario: "1942", seed: 3, turns: 2, verify: false, supplyEffects: true });
    const saved = JSON.parse(JSON.stringify(recording(r))) as ReturnType<typeof recording>;
    expect(saved.supplyEffects).toBe(true);
    expect(recordingContext(saved).supplyEffects).toBe(true);
    const again = replay(recordingContext(saved), newGame(SCENARIOS[saved.scenario], saved.seed), saved.actions);
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(r.final));
    // The setting matters: in a context with the effects off the same actions end elsewhere (the cut-off units are not eliminated).
    const off = replay({ ...recordingContext(saved), supplyEffects: false }, newGame(SCENARIOS[saved.scenario], saved.seed), saved.actions);
    expect(JSON.stringify(off.state)).not.toBe(JSON.stringify(r.final));
  }, 60_000);

  it("a recording with the effects off (or an older one) has no such field and replays with them off", () => {
    const r = runGame({ scenario: "1939", seed: 3, turns: 1, verify: false, supplyEffects: false });
    const old = JSON.parse(JSON.stringify(recording(r))) as ReturnType<typeof recording>;
    expect("supplyEffects" in old).toBe(false); // written only when on: the keys are those of older recordings
    expect(recordingContext(old).supplyEffects).toBe(false);
    expect(JSON.stringify(replay(recordingContext(old), newGame(SCENARIOS[old.scenario], old.seed), old.actions).state)).toBe(JSON.stringify(r.final));
  }, 60_000);

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

  it("the figures equal a recount from the replayed game: spending, losses in units and factors, holdings, forces", () => {
    const one = runGame({ scenario: "1939", seed: 2, turns: 3 });
    const t = one.turns[one.turns.length - 1]!;
    const sumT = (f: (x: typeof t) => number) => one.turns.reduce((n, x) => n + f(x), 0);
    // Replay all but the action that crossed into the next Game Turn: the state the figures were read from.
    let state = one.initial;
    const events: GameEvent[] = [];
    const lost = { axis: 0, allies: 0 };
    const lostFactors = { axis: 0, allies: 0 };
    let spent = 0;
    for (const a of one.actions.slice(0, -1)) {
      const r = applyAction(one.ctx, state, a);
      if (!r.ok) throw new Error(r.error);
      for (const e of r.events) {
        events.push(e);
        if (e.type === "BRPS_CHANGED" && e.delta < 0) spent -= e.delta;
        if (e.type === "UNIT_ELIMINATED") {
          const u = state.units[e.unitId]!;
          lost[sideOfOwner(u.owner)]++;
          lostFactors[sideOfOwner(u.owner)] += u.strength;
        }
      }
      state = r.state;
    }
    expect(sumT((x) => Object.values(x.spent).reduce((a, b) => a + b, 0))).toBe(spent);
    expect(spent).toBeGreaterThan(0);
    expect({ axis: sumT((x) => x.lost.axis), allies: sumT((x) => x.lost.allies) }).toEqual(lost);
    expect({ axis: sumT((x) => x.lostFactors.axis), allies: sumT((x) => x.lostFactors.allies) }).toEqual(lostFactors);
    expect(lost.axis + lost.allies).toBeGreaterThan(0);
    expect(lostFactors.axis + lostFactors.allies).toBeGreaterThan(lost.axis + lost.allies); // factors are not unit counts
    const held = { axis: 0, allies: 0, neutral: 0 };
    for (const [id, h] of Object.entries(one.ctx.map.hexes)) {
      const owner = h.land ? controllerOf(one.ctx, state, id) : null;
      if (owner !== null) held[sideInWar(state, owner) ?? "neutral"]++;
    }
    expect(t.hexes).toEqual(held);
    const units = { axis: 0, allies: 0 };
    for (const u of Object.values(state.units)) units[sideOfOwner(u.owner)]++;
    expect(t.units).toEqual(units);
    for (const n of Object.keys(t.brp) as (keyof typeof t.brp)[]) expect(t.brp[n]).toBe(state.nations[n].brpTotal);
    const md = gameReport(one);
    expect(md).toContain(`${held.axis} / ${held.allies} / ${held.neutral}`);
    expect(md).toContain(`${t.lostFactors.axis} / ${t.lostFactors.allies}`);
    expect(md).toContain(`BRPs spent: ${spent}`);
    expect(sumT((x) => x.attacks.axis + x.attacks.allies)).toBe(events.filter((e) => e.type === "COMBAT_RESOLVED").length);
  }, 60_000);

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

  it("overstacks are looked for when a Player Turn ends, not before", () => {
    const plant = (st: GameState): GameState => {
      const units = { ...st.units };
      for (let i = 0; i < 8; i++) units[`x${i}`] = { id: `x${i}`, owner: "germany", type: "replacement", strength: 3, at: "L32" };
      return { ...st, units };
    };
    const r = runGame({ scenario: "1939", seed: 1, turns: 1 }, { prepare: plant });
    const over = r.anomalies.filter((a) => a.kind === "overstack");
    expect(over.length).toBeGreaterThan(0);
    // Planted before play: the first check is after the first Player Turn, so it names the second side's turn, not the first.
    expect(over[0]!.at).toContain(r.initial.firstSide === "axis" ? "allies" : "axis");
    expect(over[0]!.at).not.toContain(`${r.initial.firstSide}, step`);
  });

  it("a setup that leaves the game in the setup phase is an anomaly, not a silent stop", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 1 }, { setup: () => [] });
    expect(r.anomalies.map((a) => a.kind)).toEqual(["setup"]);
    expect(r.ended).toBe("stopped");
  });

  it("refuses a seed the engine cannot take, with a clear error", () => {
    expect(() => runGame({ scenario: "1939", seed: MAX_SEED + 1, turns: 1 })).toThrow(/Invalid seed/);
    expect(() => runGame({ scenario: "1939", seed: -1, turns: 1 })).toThrow(/Invalid seed/);
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

  it("--supply-effects on|off sets the supply effects for the run; absent, the shipped setting applies (and the report names it)", () => {
    expect(parseArgs(["--supply-effects", "on"]).supplyEffects).toBe(true);
    expect(parseArgs(["--supply-effects", "off"]).supplyEffects).toBe(false);
    expect(parseArgs([]).supplyEffects).toBeUndefined();
    for (const bad of [[], ["yes"], ["--no-verify"]]) expect(() => parseArgs(["--supply-effects", ...bad]), bad.join()).toThrow(/--supply-effects is on or off/);
    const r = runGame({ scenario: "1942", seed: 1, turns: 1, verify: false, supplyEffects: true });
    expect(r.ctx.supplyEffects).toBe(true);
    expect(r.options.supplyEffects).toBe(true);
    expect(gameReport(r)).toContain("--supply-effects on");
    expect(r.turns[0]!.lostUnsupplied.axis).toBeGreaterThan(0); // Sardinia and Norway: sea supply is not built
    expect(comparison([r])).toContain("Unsupplied lost ax / al");
    expect(runGame({ scenario: "1939", seed: 1, turns: 1, verify: false }).ctx.supplyEffects).toBe(SUPPLY_EFFECTS_ENABLED);
  }, 60_000);

  it("refuses what it does not understand", () => {
    for (const bad of [["--scenario", "1941"], ["--turns", "0"], ["--turns", "x"], ["--seed", "-1"], ["--games", "0"], ["--bogus"], ["--out"]]) expect(() => parseArgs(bad), bad.join(" ")).toThrow(/usage/);
  });

  it("checks the seed: whole, not empty, and within what the engine takes, games included", () => {
    expect(parseArgs(["--seed", String(MAX_SEED)]).seed).toBe(MAX_SEED);
    for (const bad of [[String(MAX_SEED + 1)], [""], [" "], ["1.5"], ["1e3"], ["0x10"], ["abc"]]) expect(() => parseArgs(["--seed", ...bad]), bad.join()).toThrow(/--seed needs a whole number/);
    expect(() => parseArgs(["--seed", String(MAX_SEED), "--games", "2"])).toThrow(/largest seed/);
    expect(parseArgs(["--seed", String(MAX_SEED - 1), "--games", "2"]).games).toBe(2);
  });

  it("checks --out: a folder name inside the repository, never a flag, the repository itself, or a path outside", () => {
    const root = "/repo";
    expect(parseArgs(["--out", "selfplay-out/ten"], root).out).toBe("selfplay-out/ten");
    for (const bad of ["--no-verify", ".", "./", "..", "../x", "/etc", "a/../..", "/repo"]) expect(() => parseArgs(["--out", bad], root), bad).toThrow(/--out/);
    expect(() => parseArgs(["--out", "--no-verify"], root)).toThrow(/needs a folder name/);
  });

  it("prepares the output folder: refuses a file, keeps reports out of git, says when it holds files", () => {
    const root = mkdtempSync(join(tmpdir(), "selfplay-"));
    writeFileSync(join(root, "a-file"), "x");
    expect(() => prepareOut(root, "a-file")).toThrow(/is a file/);
    const first = prepareOut(root, "reports/one");
    expect(first.existing).toBe(false);
    expect(readFileSync(join(first.dir, ".gitignore"), "utf8")).toBe("*\n");
    writeFileSync(join(first.dir, "x.md"), "old");
    expect(prepareOut(root, "reports/one").existing).toBe(true);
    mkdirSync(join(root, "empty"));
    expect(prepareOut(root, "empty").existing).toBe(false);
    expect(existsSync(join(root, "--no-verify"))).toBe(false);
  });
});
