import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { chooseAction } from "../src/ai";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame, turnIndex } from "../src/engine/game";
import { setupStatus } from "../src/engine/requirements";
import type { ForceOwner, GameState, Scenario, Unit, UnitType } from "../src/engine/types";
import { FULL_LABEL_LIMIT, labelled, unitsWhere } from "../src/ui/actionLabels";
import { buttonLabels } from "../src/ui/statusView";
import { CTX, atStart } from "./helpers";

/**
 * Two buttons of one list never read the same (focusKeep.ts finds a button again by its exact label), legal actions that do exactly
 * the same are shown once, and a long label is shortened (spec 07, part B).
 */

const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, movement: number | undefined, at: string, nationality?: ForceOwner): Unit => ({
  id,
  owner,
  type,
  strength,
  at,
  ...(movement === undefined ? {} : { movement }),
  ...(nationality ? { nationality } : {}),
});
const at7h = (units: Unit[], seed = 1): GameState => ({
  ...atStart(SCENARIO_1939, 1),
  activeSide: "axis",
  position: { part: "player-turn", turn: 1, step: "7h" },
  units: Object.fromEntries(units.map((u) => [u.id, u])),
  rngState: seed,
});
const advance = (units: string[], to = "M35"): Action => ({ type: "ADVANCE", side: "axis", units, to });

describe("identical actions and the numbering of those that still read alike", () => {
  const armor = [unit("a1", "germany", "armor", 4, 4, "M34"), unit("a2", "germany", "armor", 4, 4, "M34"), unit("a3", "germany", "armor", 4, 4, "M34")];
  const label = (a: Action) => unitsWhere(CTX, state, a.type === "ADVANCE" ? a.units : []);
  const state = at7h(armor);

  it("shows one button for actions that differ only in which of identical counters they name", () => {
    const shown = labelled([advance(["a1"]), advance(["a2"]), advance(["a3"]), advance(["a1", "a2"]), advance(["a2", "a3"])], CTX, state, label);
    expect(shown.map((l) => l.text)).toEqual(["4-4 German armor from M34", "2 x 4-4 German armor from M34"]);
    expect(shown.map((l) => l.action)).toEqual([advance(["a1"]), advance(["a1", "a2"])]);
  });

  it("keeps the actions that differ in where the counters stand", () => {
    const s = at7h([unit("a1", "germany", "armor", 4, 4, "M34"), unit("a2", "germany", "armor", 4, 4, "N34")]);
    const shown = labelled([advance(["a1"]), advance(["a2"])], CTX, s, (a) => unitsWhere(CTX, s, a.type === "ADVANCE" ? a.units : []));
    expect(shown.map((l) => l.text)).toEqual(["4-4 German armor from M34", "4-4 German armor from N34"]);
  });

  it("numbers buttons that read alike but differ in a way the words leave out (here the owner of a borrowed fleet)", () => {
    const s = at7h([unit("f1", "germany", "fleet", 2, undefined, "A1", "italy"), unit("f2", "italy", "fleet", 2, undefined, "A1")]);
    const shown = labelled([advance(["f1"]), advance(["f2"])], CTX, s, (a) => unitsWhere(CTX, s, a.type === "ADVANCE" ? a.units : []));
    expect(shown.map((l) => l.text)).toEqual(["2 Italian fleet from A1 (1 of 2)", "2 Italian fleet from A1 (2 of 2)"]);
  });
});

describe("a long label", () => {
  it("is told by kind and count, with the rest folded into 'more units from N hexes'", () => {
    const hexes = ["M33", "N33", "O33", "M34", "N34"];
    const units = hexes.flatMap((h, i) => [unit(`i${i}a`, "germany", "infantry", 3, 3, h), unit(`i${i}b`, "germany", "infantry", 3, 3, h), unit(`t${i}`, "germany", "armor", 4, 6, h)]);
    const s = at7h(units);
    const text = unitsWhere(CTX, s, units.map((u) => u.id));
    expect(text).toBe("2 German infantry, 1 German armor from Poznan (M33) and 2 German infantry, 1 German armor from Lodz (N33) and 9 more units from 3 hexes");
    expect(text.length).toBeLessThan(FULL_LABEL_LIMIT * 2);
    expect(unitsWhere(CTX, s, ["i0a", "t0"])).toBe("3-3 German infantry, 4-6 German armor from Poznan (M33)");
  });
});

/** Computer self-play, as in ai-selfplay.test.ts: every position it reaches is a sample of what the buttons must tell apart. */
const SCENARIOS: Scenario[] = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];
const GAME_TURNS = 3;
const SEEDS = [1, 2];

function samples(scenario: Scenario, seed: number): { ctx: GameContext; state: GameState }[] {
  const ctx: GameContext = { map: MAP, scenario };
  let state = newGame(scenario, seed);
  for (const a of autoSetup(ctx, state)) {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  const out: { ctx: GameContext; state: GameState }[] = [];
  const stop = turnIndex(state) + GAME_TURNS;
  for (let n = 0; state.phase === "player-turn" && turnIndex(state) < stop && n < 3000; n++) {
    const step = state.position?.part === "player-turn" ? state.position.step : "";
    if (step === "7h" || n % 7 === 0) out.push({ ctx, state });
    const d = chooseAction(ctx, state, { seed });
    if (!d) break;
    const r = applyAction(ctx, state, d.action);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return out;
}

describe("the buttons of real positions", () => {
  for (const scenario of SCENARIOS) {
    it.skipIf(!setupStatus({ map: MAP, scenario }).startable)(`${scenario.name}: no two buttons read alike, no unit id, none too long`, () => {
      let combat = 0;
      let dropped = 0;
      let maxLen = 0;
      for (const seed of SEEDS) {
        for (const { ctx, state } of samples(scenario, seed)) {
          const shown = buttonLabels(legalActions(ctx, state), ctx, state);
          const texts = shown.map((l) => l.text);
          expect(new Set(texts).size, `${state.position && JSON.stringify(state.position)}: ${texts.join(" | ")}`).toBe(texts.length);
          for (const t of texts) {
            expect(t).not.toMatch(/\bu\d+\b/);
            expect(t.length, t).toBeLessThanOrEqual(160);
            maxLen = Math.max(maxLen, t.length);
          }
          dropped += legalActions(ctx, state).filter((a) => a.type !== "BUILD" && a.type !== "MOVE").length - shown.length;
          combat += shown.filter((l) => l.action.type === "ATTACK" || l.action.type === "ADVANCE" || l.action.type === "ALLOCATE_LOSSES").length;
        }
      }
      expect(combat, "the sample reaches real fights").toBeGreaterThan(50);
      expect(dropped, "and real duplicates").toBeGreaterThan(0);
      expect(maxLen).toBeLessThanOrEqual(160);
    }, 120_000);
  }
});
