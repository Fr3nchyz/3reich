import { describe, expect, it } from "vitest";
import { ORIGINAL_ZONES } from "../src/data/gamedata";
import { autoSetup } from "../src/engine/autosetup";
import { newGame } from "../src/engine/game";
import { adjacentHexes } from "../src/engine/zoc";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import { controllerOf, controllingSide } from "../src/engine/control";
import { minorDeclarationProblem } from "../src/engine/minors-declare";
import {
  BESSARABIA_HEXES, MC10_ONLY_GERMANY_ENTERS, MC10_SLEEPING_LAND_SUPPLIES, MC11_GARRISON_BAN_PERMANENT, MC11_GARRISON_REMOVES_ARMY, MC22_BESSARABIA_BAN,
  MC22_FINLAND_GARRISON_MAX_FACTORS, garrisonLimitProblem, garrisonMayEnter, noteGarrison, sleepingAlly, sleepingAllyOfHex,
} from "../src/engine/minors-axis";
import { endProblem, entryProblem, neutralLandProblem, reachableHexes } from "../src/engine/movement";
import { isUnitSupplied, supplyFriendly, supplySources, unsuppliedUnits } from "../src/engine/supply";
import type { GameState } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { at6f, errorOf, inf, move, okOf } from "./helpers-move";

// Spec 15 R10 (ticket 15-7; Ref 17.2 to 17.4, 29.0; errata): Germany walks into a sleeping Axis ally, a Garrison revokes an Allied declaration,
// German units there are in supply (the Helsinki case). Positions on the real 1939 map: R30 is Slovakia's neighbour hex next to Hungary's R31, S30 is Budapest.
const ON = { ...CTX, supplyEffects: true };
const hexesOf = (country: string) => Object.values(CTX.map.hexes).filter((h) => h.country === country && h.land).map((h) => h.id);

/** Britain declared on Hungary (duty met by an attack from outside, no British unit inside); Hungary's army (one infantry) was placed by the Axis. */
function declared(extra: Partial<GameState> = {}): GameState {
  const s = at6f([inf("g1", "germany", "R30", 3, 3), inf("h1", "hungary", "R32", 2, 3)], "axis");
  return {
    ...s, wars: [...s.wars, ["britain", "hungary"]],
    countries: { ...s.countries, hungary: { status: "attacked", attacker: "britain" } }, ...extra,
  };
}

describe("R10: which countries are sleeping Axis allies", () => {
  const s = atStart(SCENARIO_1939, 1);
  it("the four, in the 1939 scenario", () => {
    for (const c of ["finland", "hungary", "rumania", "bulgaria"]) expect(sleepingAlly(s, c)).toBe(true);
    for (const c of ["yugoslavia", "greece", "poland", "sweden", "germany", undefined]) expect(sleepingAlly(s, c)).toBe(false);
  });
  it("not once it is awake (R9)", () => {
    const woke = { ...s, minorAllies: s.minorAllies.map((m) => (m.owner === "hungary" ? { ...m, active: true } : m)) };
    expect(sleepingAlly(woke, "hungary")).toBe(false);
    expect(sleepingAlly(woke, "rumania")).toBe(true);
  });
  it("not once conquered", () => expect(sleepingAlly({ ...s, conquests: [{ country: "hungary" } as never] }, "hungary")).toBe(false));
  it("an Allied declaration leaves it asleep; an Axis declaration means it can never be an Axis ally (R9)", () => {
    expect(sleepingAlly(declared(), "hungary")).toBe(true);
    const axisDeclared = declared({ countries: { hungary: { status: "attacked", attacker: "italy" } } });
    expect(sleepingAlly({ ...axisDeclared, nations: { ...axisDeclared.nations, italy: { ...axisDeclared.nations.italy, status: "axis" } } }, "hungary")).toBe(false);
  });
  it("hexes: only land of a sleeping ally", () => {
    expect(sleepingAllyOfHex(CTX, s, "S30")).toBe("hungary");
    expect(sleepingAllyOfHex(CTX, s, "D41")).toBe("finland");
    expect(sleepingAllyOfHex(CTX, s, "L31")).toBeNull();
    expect(sleepingAllyOfHex(CTX, s, "V28")).toBeNull();
  });
  it("Bessarabia is the five Rumanian hexes of the original Eastern Europe file", () => {
    expect([...BESSARABIA_HEXES].sort()).toEqual(ORIGINAL_ZONES["eastern-europe"].filter((h) => CTX.map.hexes[h]?.country === "rumania").sort());
  });
});

describe("R10: Germany walks in (Ref 17.2), nobody else", () => {
  it("a German unit may enter a hex of each sleeping ally with no declaration, no war and no BRPs", () => {
    const s = at6f([inf("g1", "germany", "R30", 3, 3)]);
    for (const c of ["hungary", "rumania", "bulgaria", "finland"]) {
      const hex = hexesOf(c).find((h) => !BESSARABIA_HEXES.includes(h))!;
      expect(entryProblem(CTX, s, ["germany"], hex), c).toBeNull();
      expect(neutralLandProblem(CTX, s, ["germany"], hex), c).toBeNull();
    }
  });
  it("a real MOVE into Hungary is legal, costs nothing, changes no control and wakes nobody", () => {
    const s = at6f([inf("g1", "germany", "R30", 3, 3)]);
    const r = okOf(move(s, ["g1"], ["R31"]));
    expect(r.state.units.g1!.at).toBe("R31");
    expect(r.state.wars).toEqual(s.wars);
    expect(r.state.nations).toEqual(s.nations);
    expect(r.state.minorAllies).toEqual(s.minorAllies);
    expect(controllerOf(CTX, r.state, "R31")).toBeNull(); // control is not changed: no Objective counts for Germany because of it (MC10)
    expect(r.events.some((e) => e.type === "MINOR_GARRISONED")).toBe(false); // no declaration: nothing to revoke
    expect(r.state.countries?.hungary).toBeUndefined();
  });
  it("the move is listed: reachableHexes and legalActions offer the sleeping ally", () => {
    const s = at6f([inf("g1", "germany", "R30", 3, 3)]);
    expect(reachableHexes(CTX, s, [s.units.g1!]).has("R31")).toBe(true);
    expect(legalActions(CTX, s).some((a) => a.type === "MOVE" && a.path.includes("R31"))).toBe(true);
  });
  it("the Allies may not (as before)", () => {
    const s = at6f([inf("b1", "britain", "R30", 3, 3)], "allies");
    expect(entryProblem(CTX, s, ["britain"], "R31")).toMatch(/neutral land/);
    expect(errorOf(move(s, ["b1"], ["R31"]))).toMatch(/neutral land/);
  });
  it("Italy may not (MC10); with the constant off it may", () => {
    expect(MC10_ONLY_GERMANY_ENTERS).toBe(true);
    const s = at6f([inf("i1", "italy", "R30", 3, 3)]);
    expect(entryProblem(CTX, s, ["italy"], "R31")).toMatch(/neutral land/);
    expect(garrisonMayEnter(CTX, s, "italy", "R31")).toBe(false);
  });
  it("a mixed stack with an Italian unit is refused", () => {
    const s = at6f([inf("g1", "germany", "R30", 3, 3)]);
    expect(entryProblem(CTX, s, ["germany", "italy"], "R31")).toMatch(/neutral land/);
  });
  it("other neutral minors stay closed to Germany", () => {
    const s = at6f([inf("g1", "germany", "R30", 3, 3)]);
    expect(entryProblem(CTX, s, ["germany"], hexesOf("yugoslavia")[0]!)).toMatch(/neutral land/);
  });
  it("not once the ally is awake (15-8's business) or conquered: the ordinary rules apply", () => {
    const s = at6f([inf("g1", "germany", "R30", 3, 3)]);
    expect(garrisonMayEnter(CTX, { ...s, conquests: [{ country: "hungary" } as never] }, "germany", "R31")).toBe(false);
    expect(garrisonMayEnter(CTX, { ...s, minorAllies: s.minorAllies.map((m) => (m.owner === "hungary" ? { ...m, active: true } : m)) }, "germany", "R31")).toBe(false);
  });
});

describe("R10: a Garrison revokes an Allied declaration and does not wake the ally", () => {
  it("Germany walks in: the declaration is revoked, the army is removed, the ban is recorded, the ally sleeps", () => {
    const s = declared();
    expect(entryProblem(CTX, s, ["germany"], "R31")).toBeNull();
    const r = okOf(move(s, ["g1"], ["R31"]));
    expect(r.state.countries?.hungary).toEqual({ status: "neutral", closedTo: ["britain"] });
    expect(r.state.wars.some(([a, b]) => [a, b].includes("hungary"))).toBe(false);
    expect(r.state.units.h1).toBeUndefined();
    expect(r.state.units.g1!.at).toBe("R31");
    expect(r.state.minorAllies.find((m) => m.owner === "hungary")).toMatchObject({ active: false });
    expect(r.events).toContainEqual({ type: "MINOR_GARRISONED", minor: "hungary", by: "germany", revoked: "britain", removed: ["h1"] });
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal); // nothing charged to Germany
  });
  it("the revoked attacker may not declare on it again; another power may", () => {
    const r = okOf(move(declared(), ["g1"], ["R31"]));
    expect(minorDeclarationProblem(CTX, r.state, "britain", "hungary")).toMatch(/Garrison/);
    expect(minorDeclarationProblem(CTX, r.state, "france", "hungary")).toBeNull();
  });
  it("a pass-through counts: the path crosses Hungary and ends outside", () => {
    const s = declared();
    const out = adjacentHexes(CTX, "R31").find((h) => h !== "R30" && CTX.map.hexes[h]?.land && CTX.map.hexes[h]?.country !== "hungary" && CTX.map.hexes[h]?.country !== "rumania")!;
    const r = okOf(move(s, ["g1"], ["R31", out]));
    expect(r.state.countries?.hungary?.status).toBe("neutral");
  });
  it("the duty (R4) and placement flags of the revoked declaration go with it", () => {
    const s = declared({ countries: { hungary: { status: "attacked", attacker: "britain", duty: { by: "britain", declared: { year: 1939, season: "fall" } as never }, toPlace: "axis" } } });
    const r = okOf(move(s, ["g1"], ["R31"]));
    expect(r.state.countries?.hungary).toEqual({ status: "neutral", closedTo: ["britain"] });
  });
  it("an earlier ban is kept and extended", () => {
    const s = declared({ countries: { hungary: { status: "attacked", attacker: "britain", closedTo: ["france"] } } });
    expect(okOf(move(s, ["g1"], ["R31"])).state.countries?.hungary?.closedTo).toEqual(["france", "britain"]);
  });
  it("an Allied unit inside: Germany's entry is an Intervention (15-8), not a Garrison, so it is refused here and nothing is revoked", () => {
    const s = declared();
    const withB = { ...s, units: { ...s.units, b1: inf("b1", "britain", "R32", 3, 3) } };
    expect(garrisonMayEnter(CTX, withB, "germany", "R31")).toBe(false);
    expect(entryProblem(CTX, withB, ["germany"], "R31")).not.toBeNull();
    expect(noteGarrison(CTX, withB, [s.units.g1!], ["R31"]).events).toEqual([]);
  });
  it("Italian units never make a Garrison", () => {
    const s = declared();
    expect(noteGarrison(CTX, s, [inf("i1", "italy", "R31")], ["R31"]).state).toBe(s);
  });
  it("a hex outside the ally revokes nothing", () => {
    const s = declared();
    expect(noteGarrison(CTX, s, [s.units.g1!], ["R30"]).state).toBe(s);
  });
  it("the constants: the army is removed and the ban permanent", () => {
    expect(MC11_GARRISON_REMOVES_ARMY).toBe(true);
    expect(MC11_GARRISON_BAN_PERMANENT).toBe(true);
  });
  it("replays: the same actions give the same state", () => {
    const s = declared();
    const a = okOf(applyAction(CTX, s, { type: "MOVE", side: "axis", units: ["g1"], path: ["R31"] }));
    const b = okOf(applyAction(CTX, s, { type: "MOVE", side: "axis", units: ["g1"], path: ["R31"] }));
    expect(a.state).toEqual(b.state);
  });
});

describe("R10, MC22: the Garrison limits", () => {
  const moving = (factors: number) => inf("x1", "germany", "L32", factors, 3);
  it("Finland: five German factors, no more (errata)", () => {
    expect(MC22_FINLAND_GARRISON_MAX_FACTORS).toBe(5);
    const s = at6f([inf("g1", "germany", "D41", 3, 3), inf("g2", "germany", "D42", 2, 3)]); // five there already
    expect(garrisonLimitProblem(CTX, s, [moving(1)], "D43")).toMatch(/at most 5/i);
    expect(endProblem(CTX, s, [moving(1)], "D43")).toMatch(/at most 5/i);
    expect(garrisonLimitProblem(CTX, at6f([inf("g1", "germany", "D41", 3, 3)]), [moving(2)], "D43")).toBeNull(); // 3 + 2 = 5 is allowed
    expect(garrisonLimitProblem(CTX, at6f([inf("g1", "germany", "D41", 3, 3)]), [moving(3)], "D43")).toMatch(/at most 5/i); // 6
  });
  it("Finland: units that move inside Finland are not counted twice", () => {
    const s = at6f([inf("g1", "germany", "D41", 3, 3), inf("g2", "germany", "D42", 2, 3)]);
    expect(garrisonLimitProblem(CTX, s, [s.units.g2!], "D43")).toBeNull();
  });
  it("the limit is for Germany in Finland only: other countries and other owners are free", () => {
    const s = at6f([inf("g1", "germany", "D41", 3, 3), inf("g2", "germany", "D42", 2, 3)]);
    expect(garrisonLimitProblem(CTX, s, [moving(4)], hexesOf("hungary")[0]!)).toBeNull();
    expect(garrisonLimitProblem(CTX, s, [inf("i1", "italy", "L32", 4, 3)], "D43")).toBeNull();
  });
  it("Bessarabia: no German entry without war on the U.S.S.R.; allowed once at war (Ref 29.0)", () => {
    expect(MC22_BESSARABIA_BAN).toBe(true);
    const s = at6f([inf("g1", "germany", "S35", 3, 3)]);
    expect(entryProblem(CTX, s, ["germany"], "S36")).toMatch(/Bessarabia/);
    expect(errorOf(move(s, ["g1"], ["S36"]))).toMatch(/Bessarabia/);
    expect(entryProblem(CTX, s, ["germany"], "S35")).toBeNull(); // the rest of Rumania is fine
    const war = { ...s, wars: [...s.wars, ["germany", "ussr"] as [never, never]] };
    expect(entryProblem(CTX, war, ["germany"], "S36")).toBeNull();
  });
  it("Bessarabia stops being Rumanian once Eastern Europe is created (15-11): the Garrison rule no longer applies to it", () => {
    const s = at6f([inf("g1", "germany", "S35", 3, 3)], "axis", SCENARIO_1939, { countries: { "eastern-europe": { status: "neutral" } } });
    expect(sleepingAllyOfHex(CTX, s, "S36")).toBeNull();
    expect(sleepingAllyOfHex(CTX, s, "S35")).toBe("rumania");
  });
});

describe("R10, MC10: German units in a sleeping ally are in supply (the Helsinki case), with the supply switch on", () => {
  const s = atStart(SCENARIO_1939, 1);
  it("1939: the armor at Helsinki is supplied; before 15-7 it was the one unit cut off", () => {
    let set: GameState = newGame(SCENARIO_1939, 1); // the computer's setup puts a German armor in Helsinki
    for (const a of autoSetup(CTX, set)) set = okOf(applyAction(CTX, set, a)).state;
    const armor = Object.values(set.units).find((u) => u.owner === "germany" && u.at === "D41");
    expect(armor).toBeDefined();
    expect(isUnitSupplied(ON, set, armor!.id)).toBe(true);
    expect(unsuppliedUnits(ON, set, "axis")).toEqual([]);
  });
  it("the capitals of the four sleeping allies are Axis sources while they sleep, and the Allies' are not", () => {
    expect(supplySources(CTX, s, "axis")).toEqual(expect.arrayContaining(["D41", "S30", "W33", "Y30"]));
    expect(supplySources(CTX, s, "allies")).not.toEqual(expect.arrayContaining(["S30"]));
  });
  it("a German unit in Hungary is supplied even if Berlin is lost: the capital Budapest is a source", () => {
    const g = at6f([inf("g1", "germany", "R31", 3, 3)], "axis", SCENARIO_1939, { control: { L31: "poland" } });
    expect(unsuppliedUnits(ON, g, "axis")).toEqual([]);
  });
  it("a German unit in Rumania is supplied from Bucharest; a unit in neutral Yugoslavia is not", () => {
    const g = at6f([inf("g1", "germany", "S35", 3, 3), inf("g2", "germany", "V28", 3, 3)]);
    expect(unsuppliedUnits(ON, g, "axis")).toEqual(["g2"]);
  });
  it("supplyFriendly: Axis sees sleeping land as its own, the Allies do not; control is unchanged", () => {
    expect(supplyFriendly(CTX, s, "axis", "S30")).toBe(true);
    expect(supplyFriendly(CTX, s, "allies", "S30")).toBe(false);
    expect(supplyFriendly(CTX, s, "axis", "V28")).toBe(false);
    expect(supplyFriendly(CTX, s, "axis", "L31")).toBe(true); // Berlin: ordinary control
    expect(controllingSide(CTX, s, "S30")).toBeNull();
    expect(controllerOf(CTX, s, "S30")).toBeNull();
  });
  it("not once the ally is conquered, and (with the constant) only while the switch of MC10 is on", () => {
    expect(MC10_SLEEPING_LAND_SUPPLIES).toBe(true);
    expect(supplyFriendly(CTX, { ...s, conquests: [{ country: "hungary" } as never] }, "axis", "S30")).toBe(false);
    expect(supplySources(CTX, { ...s, conquests: [{ country: "finland" } as never] }, "axis")).not.toContain("D41");
  });
  it("an enemy ground unit on the sleeping capital cuts it off as for any source", () => {
    const g = at6f([inf("g1", "germany", "R31", 3, 3), inf("b1", "britain", "S30", 3, 3)], "axis", SCENARIO_1939, { control: { L31: "poland" }, minorAllies: s.minorAllies.filter((m) => m.owner === "hungary") });
    expect(unsuppliedUnits(ON, g, "axis")).toEqual(["g1"]); // Berlin lost, Budapest holds an enemy: the only other sleeping capitals are not allies here
  });
});
