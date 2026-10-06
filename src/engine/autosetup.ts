import { applyAction, type Action } from "./actions";
import type { GameContext } from "./context";
import { setupOf } from "./game";
import {
  EMPTY,
  FACTOR_TYPES,
  countsForMinFactors,
  currentSetupOwner,
  factorsOf,
  placementPlaces,
  poolSpecs,
  resolveArea,
  setupStatus,
  union,
  unitsOf,
  type Place,
  type UnitSpec,
} from "./setup";
import type { ForceOwner, GameState } from "./types";

/**
 * A legal setup, not a good one: places each owner's counters on the first hexes that rules
 * allow, after the setup requirements. It exists so the game can start before the setup screen
 * and the computer opponent do (both will choose their own placements). Throws if the scenario
 * cannot be set up yet (see setupStatus).
 */
export function autoSetup(ctx: GameContext, initial: GameState): Action[] {
  const status = setupStatus(ctx);
  if (!status.startable) throw new Error(`${ctx.scenario.name} cannot be set up yet: the hexes of ${status.unresolved.join(", ")} are not known.`);
  let state = initial;
  const actions: Action[] = [];
  const act = (a: Action) => {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(`autoSetup: ${r.error}`);
    state = r.state;
    actions.push(a);
  };
  const placeFirst = (owner: ForceOwner, spec: UnitSpec, prefer: (p: Place) => boolean = () => true): boolean => {
    const places = placementPlaces(ctx, state, owner, spec);
    const at = places.find(prefer);
    if (at === undefined) return false;
    act({ type: "SETUP_PLACE", owner, unit: spec, at });
    return true;
  };
  while (state.phase === "setup") {
    const owner = currentSetupOwner(state)!;
    const f = setupOf(ctx.scenario, owner);
    // 1. The placements the page names.
    for (const r of f.setup) {
      if (r.kind !== "place") continue;
      const places = r.in.reduce((acc, a) => union(acc, resolveArea(ctx, a)), EMPTY).places;
      for (let i = 0; i < r.count; i++) {
        const spec = poolSpecs(state, owner).find((s) => s.type === r.type && (r.strength === undefined || s.strength === r.strength) && !s.nationality);
        if (!spec || !placeFirst(owner, spec, (p) => places.has(p))) throw new Error(`autoSetup: cannot place ${r.type} for ${owner}`);
      }
    }
    // 2. Enough factors on a Front, strongest counters first.
    for (const r of f.setup) {
      if (r.kind !== "min-factors") continue;
      const enough = () => unitsOf(state, owner).filter((u) => countsForMinFactors(ctx, r, u)).reduce((n, u) => n + factorsOf(u), 0) >= r.min;
      while (!enough()) {
        const specs = poolSpecs(state, owner).filter((s) => FACTOR_TYPES.includes(s.type) && s.type !== "air").sort((a, b) => b.strength - a.strength);
        const placed = specs.some((s) => placeFirst(owner, s, (p) => countsForMinFactors(ctx, r, { id: "", owner, type: s.type, strength: s.strength, at: p })));
        if (!placed) throw new Error(`autoSetup: cannot reach ${r.min} factors on the ${r.front} front for ${owner}`);
      }
    }
    // 3. Everything else, wherever it is allowed.
    for (const s of poolSpecs(state, owner)) {
      for (let i = 0; i < s.count; i++) {
        if (!placeFirst(owner, { type: s.type, strength: s.strength, ...(s.nationality ? { nationality: s.nationality } : {}) })) {
          throw new Error(`autoSetup: no legal hex for ${owner}'s ${s.strength}-factor ${s.type}`);
        }
      }
    }
    act({ type: "SETUP_DONE", owner });
  }
  return actions;
}
