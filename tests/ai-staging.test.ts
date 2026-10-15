import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { plannedTargets, STAGING_ENABLED, STAGING_LEAD_TURNS } from "../src/ai/declare";
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
  let s: GameState = { ...at6f(units), year: 1941, season: "spring" };
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
  it("the Axis plans against the neutral U.S.S.R. (from STAGING_LEAD_TURNS before Summer 1941, not earlier); the Allies have no plan; no one is neutral in 1942", () => {
    const s: GameState = { ...at6f([]), year: 1941, season: "spring" };
    expect(plannedTargets(s, "axis")).toEqual(["ussr"]);
    expect(STAGING_LEAD_TURNS).toBe(2);
    expect(plannedTargets({ ...s, year: 1940, season: "winter" }, "axis")).toEqual(["ussr"]); // two Game Turns before Summer 1941
    expect(plannedTargets({ ...s, year: 1940, season: "fall" }, "axis")).toEqual([]);
    expect(STAGING_ENABLED).toBe(true);
    expect(plannedTargets(s, "axis", false)).toEqual([]); // switched off: nothing is staged
    expect(plannedTargets(at6f([]), "axis")).toEqual([]); // Fall 1939: far too early to wait at a border
    expect(plannedTargets(s, "allies")).toEqual([]);
    expect(plannedTargets(newGame(SCENARIO_1942, 1), "axis")).toEqual([]);
  });

  it("the waiting places are the Soviet-held capitals and objectives, and the U.S.S.R.'s land counts as open for them", () => {
    const early = { ...at6f([]), year: 1941, season: "spring" as const };
    const { sources, open } = stagingTargets(CTX, early, "axis");
    expect(open).toEqual(new Set(["ussr"]));
    expect(sources).toContain("N49"); // Moscow
    expect(sources.every((h) => controllerOf(CTX, early, h) === "ussr")).toBe(true);
    expect(stagingTargets(CTX, early, "allies").sources).toEqual([]);
    expect(stagingTargets(CTX, at6f([]), "axis").sources).toEqual([]);
  });

  it("ground distance stops at a neutral border unless that country is named open", () => {
    const s = at6f([]);
    const shut = groundDistances(CTX, s, "germany", ["N49"]);
    const open = groundDistances(CTX, s, "germany", ["N49"], undefined, new Set(["ussr"]));
    expect(shut.has("L32")).toBe(false);
    // The same for a minor country (Belgium is neutral, with no controller): named open, its land is a way through.
    expect(groundDistances(CTX, s, "germany", ["O22"]).has("M26")).toBe(false);
    expect(groundDistances(CTX, s, "germany", ["O22"], undefined, new Set(["belgium"])).has("M26")).toBe(true);
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
    const to = dest(d.action as Move);
    expect(field.get(to)!).toBeLessThan(field.get("L32")!);
    // The reason gives the exact figures of the staging distance (an off-by-one in it shows here).
    expect(d.why).toContain(`${field.get("L32")! - field.get(to)!} hex`);
    expect(d.why).toContain(`(${field.get(to)} to go)`);
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

  it("a staged unit does not keep the waiting place as its target (a real objective later replaces it at once)", () => {
    const mem = createMemory();
    expect(decide(westWon(), mem).action.type).toBe("MOVE");
    expect(mem.targets.has("u1")).toBe(false);
    expect(mem.left.get("u1")).toEqual([{ hex: "L32", turn: expect.any(Number) }]); // where it has been is still kept
  });

  it("does not wait at the border before the plan is near: in Fall 1939 the same unit stays", () => {
    const early: GameState = { ...westWon(), year: 1939, season: "fall" };
    expect(decide(early).action.type).toBe("END_STEP");
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
