import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { isBox } from "../src/engine/areas";
import type { GameContext } from "../src/engine/context";
import { GROUND_FOR_STACKING, stackingProblem, type UnitSpec } from "../src/engine/placement";
import { portCapacity } from "../src/engine/naval-ports";
import { AIR_FACTOR_STACKING_LIMIT, NAVAL_FACTOR_STACKING_LIMIT, STACKING_LIMIT, STACKING_LIMIT_LONDON_BRITISH } from "../src/engine/tables";
import type { ForceOwner, GameState } from "../src/engine/types";
import { positionsAt6f, type Position } from "./helpers-positions";

// Spec 09, ticket 09-1: stackingProblem now reads an air base's capacity (Ref 20.1, 5.0). It must behave exactly as before for every case
// that has no airbase counter on a city: this test keeps a copy of the function as it was (main at 985f156) and compares the two on every
// hex of real positions from computer-against-computer games in all four scenarios.

function stackingProblemBefore(ctx: GameContext, state: GameState, owner: ForceOwner, spec: UnitSpec, place: string): string | null {
  if (isBox(place)) return null;
  const here = Object.values(state.units).filter((u) => u.at === place);
  if (GROUND_FOR_STACKING.includes(spec.type)) {
    const ground = here.filter((u) => GROUND_FOR_STACKING.includes(u.type));
    const allBritish = owner === "britain" && ground.every((u) => u.owner === "britain");
    const limit = ctx.map.hexes[place]?.name === "London" && allBritish ? STACKING_LIMIT_LONDON_BRITISH : STACKING_LIMIT;
    if (ground.length + 1 > limit) return `${place} already holds ${ground.length} ground units (limit ${limit}).`;
  }
  if (spec.type === "air") {
    const air = here.filter((u) => u.type === "air").reduce((n, u) => n + u.strength, 0);
    if (air + spec.strength > AIR_FACTOR_STACKING_LIMIT) return `${place} would hold ${air + spec.strength} air factors (limit ${AIR_FACTOR_STACKING_LIMIT}).`;
  }
  if (spec.type === "fleet") {
    const naval = here.filter((u) => u.type === "fleet").reduce((n, u) => n + u.strength, 0);
    // Changed in ticket 12-4 (the port's own capacity: 9 at Malta, Suda Bay and Famagusta); this test is about air, so the earlier self follows it.
    const limit = portCapacity(ctx, place) > 0 ? portCapacity(ctx, place) : NAVAL_FACTOR_STACKING_LIMIT;
    if (naval + spec.strength > limit) return `${place} would hold ${naval + spec.strength} naval factors (limit ${limit}).`;
  }
  if (state.year < 1942 && (owner === "britain" || owner === "france")) {
    const other = owner === "britain" ? "france" : "britain";
    if (here.some((u) => u.owner === other)) return `British and French units may not stack together before 1942.`;
  }
  return null;
}

const SPECS: UnitSpec[] = [
  { type: "infantry", strength: 3 },
  { type: "armor", strength: 4 },
  { type: "airborne", strength: 2 },
  { type: "replacement", strength: 1 },
  { type: "air", strength: 1 },
  { type: "air", strength: 3 },
  { type: "air", strength: 5 },
  { type: "fleet", strength: 3 },
  { type: "fleet", strength: 36 },
];
const OWNERS: ForceOwner[] = ["germany", "britain", "france"];

const SCENARIOS = [SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944];

describe("stackingProblem against its earlier self (09-1: air capacity changes nothing without airbase counters)", () => {
  const positions: Position[] = SCENARIOS.flatMap((sc) => positionsAt6f(sc, 1, 2, 3));

  it("has positions from all four scenarios, with air units on the map", () => {
    expect(new Set(positions.map((p) => p.ctx.scenario.name)).size).toBe(4);
    expect(positions.length).toBeGreaterThanOrEqual(8);
    expect(positions.some((p) => Object.values(p.state.units).some((u) => u.type === "air"))).toBe(true);
    expect(positions.some((p) => p.state.year < 1942)).toBe(true);
    expect(positions.some((p) => p.state.year >= 1942)).toBe(true);
    // The identity below holds because no airbase counter stands on a city in these positions; say so if that changes.
    expect(positions.some((p) => Object.values(p.state.units).some((u) => u.type === "airbase"))).toBe(false);
  });

  it("agrees on every hex and box, for every counter kind and owner tried, in every position", () => {
    let compared = 0;
    let refusals = 0;
    let airRefusals = 0;
    for (const p of positions) {
      const places = [...Object.keys(MAP.hexes), "us-box", "murmansk-box"];
      for (const place of places) {
        for (const owner of OWNERS) {
          for (const spec of SPECS) {
            const before = stackingProblemBefore(p.ctx, p.state, owner, spec, place);
            const now = stackingProblem(p.ctx, p.state, owner, spec, place);
            if (now !== before) throw new Error(`${p.label}: ${owner} ${spec.type} ${spec.strength} at ${place}: before ${String(before)}, now ${String(now)}`);
            compared++;
            if (before !== null) refusals++;
            if (before !== null && spec.type === "air" && before.includes("air factors")) airRefusals++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(300_000);
    expect(airRefusals).toBeGreaterThan(0); // some bases are full in these positions
    expect(refusals).toBeGreaterThan(500); // the comparison is not all "fits"
  }, 120_000);
});
