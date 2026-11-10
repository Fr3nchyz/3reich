import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import type { MapHex } from "../src/engine/map";
import type { GameState } from "../src/engine/types";
import { airMissionModel } from "../src/ui/airMissionModel";
import { airResultModel } from "../src/ui/airResultModel";
import { airMissionHtml, takeAirMission } from "../src/ui/airMissionView";
import { newSession } from "../src/ui/session";
import { board, counter } from "./board";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { okOf } from "./helpers-move";

const hexes = Object.fromEntries(Array.from({ length: 6 }, (_, n) => {
  const id = `A${n + 1}`;
  return [id, { id, land: "plain", sea: false, country: n === 0 ? "germany" : "britain", front: "western", features: ["port"] } satisfies MapHex];
}));
const ctx: GameContext = { ...CTX, map: { hexes: { ...CTX.map.hexes, ...hexes }, hexsides: CTX.map.hexsides } };
const resolve: Action = { type: "RESOLVE_PORT_ATTACKS", side: "axis" };
const apply = (s: GameState, a: Action) => okOf(applyAction(ctx, s, a));
function assigned(): GameState {
  const s = board([counter("plane", "germany", "air", 3, "A1", 4), counter("fleet", "britain", "fleet", 9, "A5")], undefined, {
    activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7b" }, rngState: 13,
    airbasesPlaced: NO_AIRBASES_LEFT,
    control: Object.fromEntries(Array.from({ length: 6 }, (_, n) => [`A${n + 1}`, n === 0 ? "germany" : "britain"])),
  });
  const b = apply(s, { type: "DESIGNATE_AIR", side: "axis", mission: "port-attack", units: ["plane"], target: "A5" }).state;
  return apply(b, { type: "END_STEP", step: "7b", side: "axis" }).state;
}

describe("09-15 port card and results (spec 12 R14/R21; spec 09 UI D4)", () => {
  it("AER80: lists assigned planes and uses only the legal resolve, followed by legal continue", () => {
    const s = assigned(), before = JSON.stringify(s), m = airMissionModel(ctx, s, "axis")!;
    expect(s.position).toMatchObject({ step: "7i" });
    expect(m.title).toBe("Air attacks on ports");
    expect(m.assigned).toEqual([{ place: "A5", planes: ["3-4 German air from A1"] }]);
    expect(m.resolve).toEqual(resolve);
    expect(legalActions(ctx, s)).toContainEqual(m.resolve);
    expect(m.pass).toBeNull();
    expect(m.choices).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
    const done = apply(s, m.resolve!);
    expect(airMissionModel(ctx, done.state, "axis")).toMatchObject({ assigned: [], resolve: null, pass: { type: "END_STEP", step: "7i", side: "axis" } });
  });

  it("R14/R21: displays event dice and actual air/naval loss totals without raw unit ids", () => {
    const s = assigned(), done = apply(s, resolve), e = done.events.find(e => e.type === "PORT_ATTACK_RESOLVED")!;
    const r = airResultModel(ctx, done.events);
    expect(r).toEqual([{ title: "Air attacks on ports at A5", lines: ["Resolved", `Dice: ${e.rolls.map(r => r.roll).join(", ")}.`,
      `Actual losses: ${e.airLost} air factors; ${e.navalHits} naval hits, ${e.navalLost} naval factors lost.`] }]);
    const session = { ...newSession(CTX.scenario, "axis", 13), ctx, state: s };
    takeAirMission(session, "resolve");
    expect(session.record).toEqual([resolve]);
    expect(airMissionHtml(session)).toContain("Air attacks on ports at A5");
    expect(airMissionHtml(session)).not.toMatch(/>[^<]*(RESOLVE_PORT_ATTACKS|undefined|NaN)/);
  });

  it.each(["no-fleets", "no-air", "counter-air-blocked"] as const)("R14/AER81: explains %s with no dice", status => {
    const s = assigned();
    const changed: GameState = status === "no-fleets" ? { ...s, units: { plane: s.units.plane! } }
      : status === "no-air" ? { ...s, units: { fleet: s.units.fleet! } }
      : { ...s, air: { ...s.air!, portAttacks: [{ target: "A5", units: ["plane"], counterAir: "not-beaten" }] } };
    const done = apply(changed, resolve), e = done.events.find(e => e.type === "PORT_ATTACK_RESOLVED")!;
    expect(e.status).toBe(status);
    const r = airResultModel(ctx, done.events)[0]!;
    expect(r.lines[0]).toBe({ "no-fleets": "No enemy fleets remain", "no-air": "No assigned planes remain", "counter-air-blocked": "Blocked: defending air was not beaten" }[status]);
    expect(r.lines[1]).toBe("Dice: none.");
    expect(r.lines[2]).toBe("Actual losses: 0 air factors; 0 naval hits, 0 naval factors lost.");
  });
});
