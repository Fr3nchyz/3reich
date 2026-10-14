import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { inf } from "../src/data/counters";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { AutoSetupError, autoSetupOwner } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { setupProblems, setupStatus } from "../src/engine/requirements";
import { currentSetupOwner } from "../src/engine/setup";
import type { ForceOwner, GameState, Scenario } from "../src/engine/types";
import { CTX, ctxFor } from "./helpers";

/** "Place the rest for me" after counters were put down by hand: it must finish the nation or say why not. */

type Place = Extract<Action, { type: "SETUP_PLACE" }>;

const step = (ctx: GameContext, state: GameState, a: Action): GameState => {
  const r = applyAction(ctx, state, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

/** The game at the moment `owner` is up, every earlier nation set up automatically. */
function upTo(ctx: GameContext, owner: ForceOwner, seed = 1): GameState {
  let s = newGame(ctx.scenario, seed);
  while (currentSetupOwner(s) !== owner) s = replay(ctx, s, autoSetupOwner(ctx, s)).state;
  return s;
}

const placements = (ctx: GameContext, s: GameState): Place[] => legalActions(ctx, s).filter((a): a is Place => a.type === "SETUP_PLACE");
const hexesIn = (country: string) => Object.values(CTX.map.hexes).filter((h) => h.land && h.country === country).map((h) => h.id);

/** Puts counters down by hand, as given. */
const byHand = (ctx: GameContext, s: GameState, owner: ForceOwner, counters: { type: Place["unit"]["type"]; strength: number; at: string }[]): GameState =>
  counters.reduce((acc, c) => step(ctx, acc, { type: "SETUP_PLACE", owner, unit: { type: c.type, strength: c.strength }, at: c.at }), s);

/** Runs autoSetupOwner and checks the result is a legal, finished nation; returns what it did. */
function finish(ctx: GameContext, before: GameState) {
  const owner = currentSetupOwner(before)!;
  const actions = autoSetupOwner(ctx, before);
  const { state } = replay(ctx, before, actions);
  expect(actions.at(-1)).toEqual({ type: "SETUP_DONE", owner });
  expect(state.setup === null || state.setup.index > before.setup!.index).toBe(true);
  // Done was accepted, so the nation had nothing left to place and every requirement was met.
  expect(setupProblems(ctx, step(ctx, replay(ctx, before, actions.slice(0, -1)).state, actions.at(-1)!), owner)).toEqual([]);
  const takenBack = actions.filter((a): a is Extract<Action, { type: "SETUP_REMOVE" }> => a.type === "SETUP_REMOVE").map((a) => a.unitId);
  // Whatever was not taken back is where the player left it.
  for (const u of Object.values(before.units)) {
    if (u.owner === owner && !takenBack.includes(u.id)) expect(state.units[u.id]?.at).toBe(u.at);
  }
  return { actions, state, takenBack };
}

describe("autoSetupOwner after counters were placed by hand", () => {
  it("Britain: two 1-3s in Egypt leave none for Malta, so one of them is taken back and set down elsewhere", () => {
    const egypt = hexesIn("egypt")[0]!;
    const s = byHand(CTX, upTo(CTX, "britain"), "britain", [
      { type: "infantry", strength: 1, at: egypt },
      { type: "infantry", strength: 1, at: egypt },
    ]);
    expect(() => step(CTX, s, { type: "SETUP_DONE", owner: "britain" })).toThrow();
    const { takenBack, state } = finish(CTX, s);
    expect(takenBack).toHaveLength(1);
    expect(Object.values(state.units).filter((u) => u.owner === "britain" && u.type === "infantry" && u.strength === 1)).toHaveLength(3);
  });

  it("Britain: a lone 1-3 put anywhere but the named places leaves one named place empty", () => {
    const s0 = upTo(CTX, "britain");
    const elsewhere = placements(CTX, s0).find((a) => a.unit.type === "infantry" && a.unit.strength === 1 && CTX.map.hexes[a.at]?.country === "britain" && a.at !== "GG19")!;
    const { takenBack } = finish(CTX, step(CTX, s0, elsewhere));
    expect(takenBack).toHaveLength(1);
  });

  it("Italy: five 1-3s on the mainland leave too few for Albania and Libya", () => {
    const [a, b, c] = hexesIn("italy");
    const s = byHand(CTX, upTo(CTX, "italy"), "italy", [
      { type: "infantry", strength: 1, at: a! }, { type: "infantry", strength: 1, at: a! },
      { type: "infantry", strength: 1, at: b! }, { type: "infantry", strength: 1, at: b! },
      { type: "infantry", strength: 1, at: c! },
    ]);
    // Six 1-3s in all, three of them named (one in Albania, two in Libya): five on the mainland leave one, so two come back.
    const { takenBack } = finish(CTX, s);
    expect(takenBack).toHaveLength(2);
  });

  it("USSR: all three 3-5 armor away from Moscow", () => {
    const s0 = upTo(CTX, "ussr");
    const spots = placements(CTX, s0).filter((a) => a.unit.type === "armor" && a.at !== "H47").map((a) => a.at);
    const s = byHand(CTX, s0, "ussr", [0, 1, 2].map((i) => ({ type: "armor", strength: 3, at: spots[i * 3]! })));
    const { takenBack } = finish(CTX, s);
    expect(takenBack.length).toBeGreaterThan(0);
    expect(takenBack.length).toBeLessThanOrEqual(1);
  });

  it("Germany: twenty-two ground factors in Rumania leave too few for the Eastern Front", () => {
    const s0 = upTo(CTX, "germany");
    const rum = hexesIn("rumania");
    const s = byHand(CTX, s0, "germany", [
      ...[0, 1, 2, 3].map((i) => ({ type: "armor" as const, strength: 4, at: rum[Math.floor(i / 2)]! })),
      { type: "infantry", strength: 3, at: rum[2]! },
      { type: "infantry", strength: 3, at: rum[2]! },
    ]);
    const { takenBack } = finish(CTX, s);
    expect(takenBack.length).toBeGreaterThan(0);
  });

  it("does not touch a hand placement that already fits: nothing is taken back", () => {
    const s0 = upTo(CTX, "britain");
    const s = byHand(CTX, s0, "britain", [{ type: "infantry", strength: 1, at: "GG19" }]);
    expect(finish(CTX, s).takenBack).toEqual([]);
  });

  it("a nation with nothing placed is set up exactly as before", () => {
    const s = upTo(CTX, "britain");
    expect(finish(CTX, s).takenBack).toEqual([]);
  });

  it("fails with a typed error in plain words, not an uncaught one, when no setup can be finished at all", () => {
    // A contrived page: all of Poland's counters in one hex, which holds two ground units.
    const warsaw = Object.values(CTX.map.hexes).find((h) => h.name === "Warsaw")!.id;
    const scenario: Scenario = { ...SCENARIO_1939, forces: { ...SCENARIO_1939.forces, poland: { ...SCENARIO_1939.forces.poland!, setup: [{ kind: "all-in", types: "all", in: [{ hex: warsaw }] }], forcePool: [inf(2, 3, 3)] } } };
    const ctx = ctxFor(scenario);
    for (const hand of [0, 2]) {
      const s = byHand(ctx, newGame(scenario, 1), "poland", Array.from({ length: hand }, () => ({ type: "infantry" as const, strength: 2, at: warsaw })));
      let error: unknown;
      try {
        autoSetupOwner(ctx, s);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(AutoSetupError);
      expect((error as Error).message).toMatch(/cannot be placed automatically.*Take some back/);
    }
  });
});

// A small seeded generator so the "random" hand placements are the same on every run.
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("autoSetupOwner over many seeded hand placements", () => {
  // Only the scenarios whose setup can be played; 1942 and 1944 join as soon as setupStatus says so.
  const scenarios = [SCENARIO_1939, SCENARIO_1942, SCENARIO_1944, SCENARIO_CAMPAIGN].filter((sc) => setupStatus(ctxFor(sc)).startable);

  it("always finishes the nation legally, or fails with a typed error, never an uncaught one", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(2);
    let runs = 0;
    let moved = 0;
    for (const scenario of scenarios) {
      const ctx = ctxFor(scenario);
      let s: GameState = newGame(scenario, 7);
      while (s.phase === "setup") {
        const owner = currentSetupOwner(s)!;
        for (let seed = 0; seed < 6; seed++) {
          const rnd = mulberry(seed * 31 + owner.length);
          const n = 1 + (seed % 9);
          let hand = s;
          for (let i = 0; i < n; i++) {
            const options = placements(ctx, hand);
            if (!options.length) break;
            hand = step(ctx, hand, options[Math.floor(rnd() * options.length)]!);
          }
          runs++;
          let actions: Action[];
          try {
            actions = autoSetupOwner(ctx, hand);
          } catch (e) {
            expect(e).toBeInstanceOf(AutoSetupError);
            continue;
          }
          const { state } = replay(ctx, hand, actions);
          expect(state.setup === null || state.setup.index === hand.setup!.index + 1).toBe(true);
          if (actions.some((a) => a.type === "SETUP_REMOVE")) moved++;
        }
        s = replay(ctx, s, autoSetupOwner(ctx, s)).state;
      }
    }
    expect(runs).toBeGreaterThan(100);
    // The hand placements really do get in the way sometimes; the test would be empty otherwise.
    expect(moved).toBeGreaterThan(10);
  });
});
