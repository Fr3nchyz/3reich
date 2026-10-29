import { applyMove } from "../src/engine/move-action";
import { applySr } from "../src/engine/sr-action";
import { applyPlaceExploiters } from "../src/engine/breakthrough";
import { exploitOf } from "../src/engine/exploit-record";
import { isUnitSupplied } from "../src/engine/supply";
import type { GameEvent } from "../src/engine/action-types";
import { applyAdvance } from "../src/engine/attack";
import { combatOf } from "../src/engine/combat-record";
import { movesOf } from "../src/engine/move-record";
import { srOf } from "../src/engine/sr-record";
import { fortressSupplies } from "../src/engine/supply-sources";
import { advance } from "../src/engine/turn";
import { fortressMarkup, fortressOutlineHexes } from "../src/ui/mapCities";
import { buildHexLayers, svgMarkup } from "../src/ui/mapLayers";
import { describeEvent } from "../src/ui/session";
import { eventSide } from "../src/ui/logSide";
import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { attackNumbers } from "../src/engine/attack-rules";
import { enterHexes } from "../src/engine/control";
import { fortressChanges, refreshFortresses } from "../src/engine/fortress";
import { adjacentHexes } from "../src/engine/zoc";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Fortress status, Ref 4.8: Malta and Gibraltar always; the others lose it for good when an enemy occupies them; Maginot-Line hexes not in
// the 1942 and 1944 scenarios and gone on the fall of France; West Wall hexes from 1944 if Axis-controlled then; Sevastopol while the U.S.S.R. holds it.
// P24, P25, Q24: Maginot Line (France); M27, N26, O26, P26: West Wall (Germany); D44: a standard Fortress (U.S.S.R.); V38 Sevastopol; AA7, GG19 Malta and Gibraltar.

const forts = (s: GameState): string[] => Object.entries(refreshFortresses(CTX, s).fortresses).filter(([, v]) => v).map(([k]) => k).sort();

describe("which hexes are Fortresses (Ref 4.8)", () => {
  it("1939: Malta, Gibraltar, the Maginot Line, the standard Fortress and Sevastopol; the West Wall is not one yet", () => {
    expect(forts(board([]))).toEqual(["AA7", "D44", "GG19", "P24", "P25", "Q24", "V38"]);
  });

  it("a Fortress taken by an enemy loses the status for good, even if its owner takes it back", () => {
    const base = board([]);
    const taken = refreshFortresses(CTX, { ...base, control: { P24: "germany", D44: "germany" } });
    expect(taken.fortresses.P24).toBe(false);
    expect(taken.fortresses.D44).toBe(false);
    expect(taken.fortresses.Q24).toBe(true);
    const back = refreshFortresses(CTX, { ...taken, control: {} });
    expect(back.fortresses.P24).toBe(false);
    expect(back.fortresses.D44).toBe(false);
  });

  it("Malta and Gibraltar stay Fortresses whoever stands in them", () => {
    const s = refreshFortresses(CTX, { ...board([]), control: { AA7: "germany", GG19: "germany" } });
    expect(s.fortresses.AA7).toBe(true);
    expect(s.fortresses.GG19).toBe(true);
  });

  it("the Maginot Line goes on the fall of France", () => {
    const base = board([]);
    for (const status of ["vichy", "out", "conquered"] as const) { // "conquered": spec 14 R4 (ticket 14-5)
      const s = refreshFortresses(CTX, { ...base, nations: { ...base.nations, france: { ...base.nations.france, status } } });
      expect([s.fortresses.P24, s.fortresses.P25, s.fortresses.Q24], status).toEqual([false, false, false]);
      expect(s.fortresses.D44).toBe(true); // other Fortresses are untouched
    }
  });

  it("the Maginot Line is not a Fortress in the 1942 and 1944 scenarios", () => {
    for (const sc of [SCENARIO_1942, SCENARIO_1944]) {
      const ctx = ctxFor(sc);
      const s = refreshFortresses(ctx, board([], sc));
      expect([s.fortresses.P24, s.fortresses.P25, s.fortresses.Q24], sc.id).toEqual([false, false, false]);
    }
  });

  it("the West Wall becomes a Fortress at the start of 1944 where the Axis holds it, and only there", () => {
    const base = board([]);
    const before = refreshFortresses(CTX, { ...base, year: 1943 });
    expect(before.fortresses.M27).toBeUndefined();
    const held = refreshFortresses(CTX, { ...base, year: 1944 });
    expect(["M27", "N26", "O26", "P26"].map((h) => held.fortresses[h])).toEqual([true, true, true, true]);
    const lost = refreshFortresses(CTX, { ...base, year: 1944, control: { M27: "britain" } });
    expect(lost.fortresses.M27).toBe(false);
    const retaken = refreshFortresses(CTX, { ...lost, control: {} });
    expect(retaken.fortresses.M27).toBe(false); // never again
    const later = refreshFortresses(CTX, { ...held, control: { N26: "britain" } });
    expect(later.fortresses.N26).toBe(false);
    expect(later.fortresses.M27).toBe(true);
  });

  it("Sevastopol is a Fortress while the U.S.S.R. holds it (TODO(verify): the supply conditions of 4.8 are not built)", () => {
    expect(forts(board([]))).toContain("V38");
    const lost = refreshFortresses(CTX, { ...board([]), control: { V38: "germany" } });
    expect(lost.fortresses.V38).toBeUndefined();
    const back = refreshFortresses(CTX, { ...lost, control: {} });
    expect(back.fortresses.V38).toBe(true);
  });

  it("returns the same object when nothing changes", () => {
    const once = refreshFortresses(CTX, board([]));
    expect(refreshFortresses(CTX, once)).toBe(once);
  });
});

describe("the status goes the moment an enemy ground unit enters (Ref 4.8)", () => {
  it("a German unit entering Metz (P24) ends its status in the same Player Turn; entering Gibraltar does not", () => {
    const base = refreshFortresses(CTX, board([]));
    const unit = counter("g1", "germany", "infantry", 3, "P24", 4);
    const taken = enterHexes(CTX, base, unit, ["P24"]);
    expect(taken.state.control.P24).toBe("germany");
    expect(taken.state.fortresses.P24).toBe(false);
    expect(taken.state.fortresses.Q24).toBe(true);
    const gib = enterHexes(CTX, base, unit, ["GG19"]);
    expect(gib.state.fortresses.GG19).toBe(true);
  });
});

describe("what a Fortress does in play", () => {
  it("the defender is quadrupled in a Fortress hex, from the first Player Turn on (Ref 4.8)", () => {
    const home = adjacentHexes(CTX, "P24").find((h) => CTX.map.hexes[h]?.land)!;
    const attacker = counter("g1", "germany", "infantry", 6, home, 4);
    const defender = counter("f1", "france", "infantry", 2, "P24", 3);
    const s = board([attacker, defender], undefined, { activeSide: "axis" });
    const plain = attackNumbers(CTX, s, [attacker], [defender], "P24");
    const withStatus = attackNumbers(CTX, refreshFortresses(CTX, s), [attacker], [defender], "P24");
    expect(withStatus.multiplier).toBe(4);
    expect(plain.multiplier).toBeLessThan(4);
  });
});

// Spec 16 R26/R27/R30/R31, TODO(verify) AER38–AER40: integration at the existing turn and movement hooks.
describe("fortress news and turn hooks (spec 16 R26, R27, R31)", () => {
  const news = (events: GameEvent[]) => events.filter((e) => e.type === "FORTRESS_CHANGED");
  it("R31: enemy entry reports exactly once, with the right reason; retaking and a no-op refresh report nothing", () => {
    const base = refreshFortresses(CTX, board([]));
    const german = counter("g", "germany", "infantry", 3, "P24", 4);
    const taken = enterHexes(CTX, base, german, ["P24", "P24"]);
    expect(news(taken.events)).toEqual([{ type: "FORTRESS_CHANGED", hex: "P24", status: false, why: "enemy-entered" }]);
    const back = enterHexes(CTX, taken.state, counter("f", "france", "infantry", 2, "P24", 3), ["P24"]);
    expect(news(back.events)).toEqual([]);
    expect(fortressChanges(CTX, back.state, refreshFortresses(CTX, back.state))).toEqual([]);
  });

  it("R26/AER40: the actual fall of France leaves Maginot intact until the next Player Turn starts", () => {
    const base = refreshFortresses(CTX, board([counter("g", "germany", "infantry", 3, "O22", 4)], undefined, {
      activeSide: "allies", firstSide: "allies", control: { O22: "germany" },
      position: { part: "player-turn", turn: 1, step: "7p" },
    }));
    const fallen = advance(CTX, base);
    expect(fallen.state.nations.france.status).toBe("vichy");
    expect(news(fallen.events)).toEqual([]);
    for (const h of ["P24", "P25", "Q24"]) expect(fallen.state.fortresses[h]).toBe(true);
    const next = advance(CTX, { ...fallen.state, position: { part: "player-turn", turn: 1, step: "10b" } });
    expect(news(next.events)).toEqual(["P24", "P25", "Q24"].map((hex) => ({ type: "FORTRESS_CHANGED", hex, status: false, why: "france-fell" })));
    for (const h of ["P24", "P25", "Q24"]) expect(next.state.fortresses[h]).toBe(false);
  });

  it("R27/AER39: the first 1944 Player Turn activates only Axis-held West Wall hexes, once", () => {
    const base = refreshFortresses(CTX, board([], undefined, { year: 1943 }));
    expect(["M27", "N26", "O26", "P26"].every((h) => base.fortresses[h] === undefined)).toBe(true);
    const start = advance(CTX, { ...base, year: 1944, position: { part: "turn-order" }, control: { M27: "britain", N26: null } });
    expect(news(start.events)).toEqual(["O26", "P26"].map((hex) => ({ type: "FORTRESS_CHANGED", hex, status: true, why: "west-wall" })));
    const later = advance(CTX, { ...start.state, control: {}, position: { part: "player-turn", turn: 1, step: "10b" } });
    expect(later.state.fortresses.M27).toBe(false);
    expect(later.state.fortresses.N26).toBe(false);
    expect(news(later.events)).toEqual([]);
  });

  it("R31: Sevastopol loses and regains status with one news line each way at Player Turn start", () => {
    const base = refreshFortresses(CTX, board([]));
    const lost = advance(CTX, { ...base, control: { V38: "germany" }, position: { part: "turn-order" } });
    expect(news(lost.events)).toEqual([{ type: "FORTRESS_CHANGED", hex: "V38", status: false, why: "sevastopol" }]);
    const regained = advance(CTX, { ...lost.state, control: {}, position: { part: "turn-order" } });
    expect(news(regained.events)).toEqual([{ type: "FORTRESS_CHANGED", hex: "V38", status: true, why: "sevastopol" }]);
    for (const event of [...news(lost.events), ...news(regained.events)]) {
      expect(describeEvent(event, CTX, new Set(), new Map(), base)).toContain(event.status ? "now a fortress" : "no longer a fortress");
      expect(eventSide(event, "axis", base)).toBeNull();
    }
  });
});

describe("began in the fortress (spec 16 R30, AER38)", () => {
  const unit = counter("b", "britain", "infantry", 3, "GG19", 4);
  const base = refreshFortresses(CTX, board([unit], undefined, { activeSide: "allies" }));
  it.each(["move", "redeploy", "exploit"])("rejects a unit recorded as entering by %s, then supplies it next turn", (how) => {
    const state: GameState = how === "redeploy" ? { ...base, sr: { ...srOf(base), moved: [unit.id] } }
      : { ...base, moves: { ...movesOf(base), moved: [unit.id] } };
    expect(fortressSupplies(CTX, base, "allies", unit)).toBe(true);
    expect(fortressSupplies(CTX, state, "allies", unit)).toBe(false);
    expect(isUnitSupplied(CTX, state, unit.id)).toBe(false);
    expect(isUnitSupplied(CTX, { ...state, season: "winter" }, unit.id)).toBe(true);
    expect(fortressSupplies(CTX, { ...state, season: "winter" }, "allies", unit)).toBe(true);
    expect(fortressSupplies(CTX, state, "allies", { ...unit, id: "unmoved" })).toBe(true);
  });
  it.each(["move", "redeploy", "exploit"])("an actual %s into a friendly fortress records its arrival", (how) => {
    const french = counter("f", "france", "armor", 3, "O24", 5);
    const state = refreshFortresses(CTX, board([french], undefined, { activeSide: "allies" }));
    const result = how === "move" ? applyMove(CTX, state, { type: "MOVE", side: "allies", units: ["f"], path: ["P24"] })
      : how === "redeploy" ? applySr(CTX, state, { type: "SR_UNITS", side: "allies", units: ["f"], to: "P24" })
      : applyPlaceExploiters(CTX, { ...state, exploit: { ...exploitOf(state), groups: [{ hex: "P24", from: ["O24"], placeable: ["f"], placed: [], moved: {}, attacked: [] }] } }, { type: "PLACE_EXPLOITERS", side: "allies", hex: "P24", units: ["f"] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.state.units.f!.at).toBe("P24");
    expect(fortressSupplies(CTX, result.state, "allies", result.state.units.f!)).toBe(false);
    expect(fortressSupplies(CTX, { ...result.state, season: "winter" }, "allies", result.state.units.f!)).toBe(true);
  });
  it("records an actual advance, including for units that did not move before combat", () => {
    const french = counter("f", "france", "infantry", 2, "O24", 3);
    const s = refreshFortresses(CTX, board([french], undefined, { activeSide: "allies" }));
    const result = applyAdvance(CTX, { ...s, combat: { ...combatOf(s), advances: [{ to: "P24", units: ["f"] }] } }, { type: "ADVANCE", side: "allies", to: "P24", units: ["f"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(movesOf(result.state).moved).toContain("f");
    expect(fortressSupplies(CTX, result.state, "allies", result.state.units.f!)).toBe(false);
    expect(fortressSupplies(CTX, { ...result.state, season: "winter" }, "allies", result.state.units.f!)).toBe(true);
  });
  it("cannot establish that an anonymous hypothetical destination began in the fortress", () => {
    expect(fortressSupplies(CTX, base, "allies", { at: "GG19", owner: "britain" })).toBe(false);
  });
});

describe("active fortress outlines (spec 16 R31 / Q5)", () => {
  it("the outline set equals the active state set, including status changes and empty sets", () => {
    const base = refreshFortresses(CTX, board([]));
    for (const state of [base, { ...base, fortresses: { ...base.fortresses, P24: false, V38: false, M27: true } }, { ...base, fortresses: {} }]) {
      const expected = Object.entries(state.fortresses).filter(([, active]) => active).map(([id]) => id).sort();
      expect(fortressOutlineHexes(state)).toEqual(expected);
      expect([...fortressMarkup(CTX.map, state.fortresses).matchAll(/data-fortress="([^"]+)"/g)].map((m) => m[1])).toEqual(expected);
    }
    expect(buildHexLayers(CTX.map).cities).not.toContain('stroke-dasharray="1.2 1"');
    expect(svgMarkup(CTX.map, buildHexLayers(CTX.map).bounds, false, buildHexLayers(CTX.map))).toContain('class="fortresses"');
  });
});

// Spec 16 R31: every reason yields readable news for its hex.
it.each([
  ["enemy-entered", false, "an enemy entered"],
  ["france-fell", false, "France has fallen"],
  ["west-wall", true, "1944"],
  ["scenario-start", true, "scenario begins"],
] as const)("logs %s fortress news", (why, status, reason) => {
  const event: GameEvent = { type: "FORTRESS_CHANGED", hex: "P24", status, why };
  const line = describeEvent(event, CTX, new Set(), new Map(), board([]));
  expect(line).toContain("Metz");
  expect(line).toContain(status ? "now a fortress" : "no longer a fortress");
  expect(line).toContain(reason);
});
