import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { plannedTargets } from "../src/ai/declare";
import { enemyObjectives, groundDistances, stagingTargets } from "../src/ai/geo";
import { createMemory } from "../src/ai/memory";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { controllerOf } from "../src/engine/control";
import { newGame } from "../src/engine/game";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { neighborIds } from "../src/engine/attack-rules";
import type { GameState } from "../src/engine/types";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

// Spring 1941 in a 1939 game: Poland and France are German, so the only enemy objectives left are Britain's and its colonies
// (a sea or Turkey away) and the U.S.S.R. is neutral. Old behaviour: every German unit idles (no enemy objective on its landmass).
// New: it waits at the border of the one power the computer plans to declare war on (spec 05; Ref 13.0 declarations are step 1).
type Move = Extract<Action, { type: "MOVE" }>;
const dest = (a: Move) => a.path[a.path.length - 1]!;

/** The position with every enemy objective that a unit at L32 could walk to already German-held. */
function westWon(units = [inf("u1", "germany", "L32", 3, 3)]): GameState {
  let s = at6f(units);
  for (let i = 0; i < 10; i++) {
    const hit = enemyObjectives(CTX, s, "axis").filter((h) => groundDistances(CTX, s, "germany", [h]).has("L32"));
    if (hit.length === 0) return s;
    s = { ...s, control: { ...s.control, ...Object.fromEntries(hit.map((h) => [h, "germany" as const])) } };
  }
  throw new Error("the conquest did not settle");
}
const decide = (s: GameState, mem = createMemory()) => chooseAction(CTX, s, { seed: 1, memory: mem })!;
const newTurn = (s: GameState): GameState => ({ ...s, moves: undefined });
const nextToSoviets = (hex: string) => neighborIds(CTX, hex).some((n) => controllerOf(CTX, at6f([]), n) === "ussr");

describe("planned targets and waiting places (declare.ts, geo.ts)", () => {
  it("the Axis plans against the neutral U.S.S.R. in 1939; the Allies have no plan; no one is neutral in 1942", () => {
    const s = at6f([]);
    expect(plannedTargets(s, "axis")).toEqual(["ussr"]);
    expect(plannedTargets(s, "allies")).toEqual([]);
    expect(plannedTargets(newGame(SCENARIO_1942, 1), "axis")).toEqual([]);
  });

  it("the waiting places are the Soviet-held capitals and objectives, and the U.S.S.R.'s land counts as open for them", () => {
    const { sources, open } = stagingTargets(CTX, at6f([]), "axis");
    expect(open).toEqual(new Set(["ussr"]));
    expect(sources).toContain("N49"); // Moscow
    expect(sources.every((h) => controllerOf(CTX, at6f([]), h) === "ussr")).toBe(true);
    expect(stagingTargets(CTX, at6f([]), "allies").sources).toEqual([]);
  });

  it("ground distance stops at a neutral border unless that country is named open", () => {
    const s = at6f([]);
    const shut = groundDistances(CTX, s, "germany", ["N49"]);
    const open = groundDistances(CTX, s, "germany", ["N49"], undefined, new Set(["ussr"]));
    expect(shut.has("L32")).toBe(false);
    expect(open.get("L32")).toBeGreaterThan(5);
    expect(open.get("N49")).toBe(0);
  });
});

describe("step 6f: units with no enemy objective in reach wait at the border of a planned enemy", () => {
  it("the position is one where the old chooser idled: no enemy objective on the unit's landmass", () => {
    const s = westWon();
    expect(groundDistances(CTX, s, "germany", enemyObjectives(CTX, s, "axis")).has("L32")).toBe(false);
  });

  it("moves toward the Soviet border by a legal move and says why", () => {
    const s = westWon();
    const d = decide(s);
    expect(legalActions(CTX, s)).toContainEqual(d.action);
    expect(d.action.type).toBe("MOVE");
    expect(d.why).toMatch(/plans to declare war on.*waits at the border/);
    const field = groundDistances(CTX, s, "germany", stagingTargets(CTX, s, "axis").sources, undefined, new Set(["ussr"]));
    expect(field.get(dest(d.action as Move))!).toBeLessThan(field.get("L32")!);
  });

  it("walks up to the border, stops beside it without entering Soviet land, and then stays", () => {
    let s = westWon();
    const mem = createMemory();
    let spent = 0;
    for (let turn = 0; turn < 12; turn++) { // twelve Player Turns, each with a fresh record of who has moved
      s = newTurn(s);
      for (let n = 0; n < 5; n++) {
        const d = chooseAction(CTX, s, { seed: 1, memory: mem })!;
        if (d.action.type !== "MOVE") break;
        const r = applyAction(CTX, s, d.action);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
        spent++;
      }
    }
    const at = s.units["u1"]!.at;
    expect(spent).toBeGreaterThan(1);
    expect(controllerOf(CTX, s, at)).not.toBe("ussr");
    expect(nextToSoviets(at)).toBe(true);
    expect(decide(newTurn(s)).action.type).toBe("END_STEP"); // at the border: nothing closer to go
  });

  it("an enemy objective in reach still comes first", () => {
    const s = at6f([inf("u1", "germany", "M34", 3, 3)]);
    expect(decide(s).why).toMatch(/closer to the enemy-held objective M35/);
  });

  it("the Allies, who plan no declaration, keep a unit with no way anywhere where it is", () => {
    const s = at6f([inf("u1", "britain", "K23", 3, 3)], "allies");
    expect(decide(s).action).toEqual({ type: "END_STEP", side: "allies", step: "6f" });
  });

  it("once the war with the U.S.S.R. is on, the Soviet objectives are ordinary targets and nothing is staged", () => {
    const base = westWon();
    const war: GameState = { ...base, wars: [...base.wars, ["germany", "ussr"]], nations: { ...base.nations, ussr: { ...base.nations.ussr, status: "allied" } } };
    const d = decide(war);
    expect(d.action.type).toBe("MOVE");
    expect(d.why).toMatch(/closer to the enemy-held objective/);
    expect(d.why).not.toMatch(/waits at the border/);
  });
});

describe("the nearest-objective fields are kept for a Game Turn but follow captures", () => {
  it("a stale field is not used once the objective it named has been taken", () => {
    const s = at6f([inf("u1", "germany", "M34", 3, 3)]);
    const mem = createMemory();
    expect(decide(s, mem).why).toContain("M35");
    const taken: GameState = { ...s, control: { ...s.control, M35: "germany" } };
    expect(decide(taken, mem).why).not.toContain("M35");
  });

  it("gives the same answer with and without the memory's cache", () => {
    const s = westWon();
    const mem = createMemory();
    expect(decide(s, mem).action).toEqual(decide(s).action);
    expect(decide(s, mem).action).toEqual(decide(s, mem).action);
  });
});
