import { applyAction, type Action } from "./actions";
import type { GameContext } from "./context";
import { setupOf } from "./game";
import { resolveAreas, territoryOf, type Place } from "./areas";
import { FACTOR_TYPES, factorsOf, placementPlaces, unitsOf, type UnitSpec } from "./placement";
import { countsForMinFactors, setupStatus, unitMatches } from "./requirements";
import { currentSetupOwner, poolSpecs } from "./setup";
import type { ForceOwner, GameState, Unit } from "./types";

/**
 * Why a setup could not be finished automatically, in words a player can read. `blames` is set
 * when a counter could not be placed: it tells which counters already on the map may be in the way.
 */
export class AutoSetupError extends Error {
  constructor(message: string, readonly blames?: (u: Unit) => boolean) {
    super(message);
    this.name = "AutoSetupError";
  }
}

const STUCK = "The rest of this nation's counters cannot be placed automatically from here. Take some back and try again.";

/**
 * A legal setup for the owner now setting up, not a good one: finishes whatever is still to
 * place on the first hexes the rules allow, after the setup requirements, and ends with Done.
 * Counters already on the map stay where they are, so a player can place some by hand and let
 * this fill in the rest.
 *
 * Hand placements can leave no way to finish (a counter put outside a named placement may use up
 * a counter that placement needs; two counters in a hex may leave no room for a named one). Then
 * the counters that stand in the way are taken back, one at a time, and set down again by the
 * automatic placement: the returned actions then start with SETUP_REMOVE for each, so a caller
 * can tell the player. Only if even an empty setup cannot be finished, or the scenario cannot
 * be set up yet (see setupStatus), does it throw an AutoSetupError.
 */
export function autoSetupOwner(ctx: GameContext, initial: GameState): Action[] {
  const status = setupStatus(ctx);
  if (!status.startable) throw new AutoSetupError(`${ctx.scenario.name} cannot be set up yet: the hexes of ${status.unresolved.join(", ")} are not known.`);
  const owner = currentSetupOwner(initial);
  if (!owner) throw new AutoSetupError("The game is not in the setup phase.");
  let state = initial;
  const takenBack: Action[] = [];
  for (;;) {
    try {
      return [...takenBack, ...fillOwner(ctx, state, owner)];
    } catch (e) {
      if (!(e instanceof AutoSetupError) || !e.blames) throw e;
      const u = counterInTheWay(ctx, state, owner, e.blames);
      if (!u) throw new AutoSetupError(STUCK);
      const remove: Action = { type: "SETUP_REMOVE", owner, unitId: u.id };
      const r = applyAction(ctx, state, remove);
      if (!r.ok) throw new AutoSetupError(STUCK);
      state = r.state;
      takenBack.push(remove);
    }
  }
}

/**
 * The counter to take back next: one that could be in the way (`blames`) before any other, one that
 * no named placement is counting on before one that is, and the one placed last first.
 */
function counterInTheWay(ctx: GameContext, state: GameState, owner: ForceOwner, blames: (u: Unit) => boolean): Unit | undefined {
  const mine = unitsOf(state, owner);
  const counted = new Set<string>();
  for (const r of setupOf(ctx.scenario, owner).setup) {
    if (r.kind !== "place") continue;
    const places = resolveAreas(ctx, r.in).places;
    mine.filter((u) => unitMatches(u, r) && places.has(u.at)).slice(0, r.count).forEach((u) => counted.add(u.id));
  }
  const rank = (u: Unit) => (blames(u) ? 0 : 2) + (counted.has(u.id) ? 1 : 0);
  const age = (u: Unit) => Number(u.id.slice(1));
  return [...mine].sort((a, b) => rank(a) - rank(b) || age(b) - age(a))[0];
}

/** One attempt at finishing the owner's setup with every counter already on the map kept. */
function fillOwner(ctx: GameContext, initial: GameState, owner: ForceOwner): Action[] {
  let state = initial;
  const actions: Action[] = [];
  const act = (a: Action) => {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new AutoSetupError(r.error);
    state = r.state;
    actions.push(a);
  };
  const placeFirst = (spec: UnitSpec, prefer: (p: Place) => boolean = () => true): boolean => {
    const at = placementPlaces(ctx, state, owner, spec).find(prefer);
    if (at === undefined) return false;
    act({ type: "SETUP_PLACE", owner, unit: spec, at });
    return true;
  };
  const f = setupOf(ctx.scenario, owner);
  // 1. The placements the page names, less what is already there.
  for (const r of f.setup) {
    if (r.kind !== "place") continue;
    const places = resolveAreas(ctx, r.in).places;
    const have = unitsOf(state, owner).filter((u) => unitMatches(u, r) && places.has(u.at)).length;
    for (let i = have; i < r.count; i++) {
      const spec = poolSpecs(state, owner).find((s) => unitMatches(s, r));
      if (!spec || !placeFirst(spec, (p) => places.has(p))) throw new AutoSetupError(STUCK, (u) => unitMatches(u, r));
    }
  }
  // 2. Enough factors on a Front, strongest counters first.
  for (const r of f.setup) {
    if (r.kind !== "min-factors") continue;
    const enough = () => unitsOf(state, owner).filter((u) => countsForMinFactors(ctx, r, u)).reduce((n, u) => n + factorsOf(u), 0) >= r.min;
    while (!enough()) {
      const specs = poolSpecs(state, owner).filter((s) => FACTOR_TYPES.includes(s.type) && s.type !== "air").sort((a, b) => b.strength - a.strength);
      const placed = specs.some((s) => placeFirst(s, (p) => countsForMinFactors(ctx, r, { id: "", owner, type: s.type, strength: s.strength, at: p })));
      if (!placed) throw new AutoSetupError(STUCK, (u) => FACTOR_TYPES.includes(u.type) && !countsForMinFactors(ctx, r, u));
    }
  }
  // 3. Everything else: in the areas a "rest-in" requirement names, if any; then in the owner's own
  // territory, so that a Major Power does not fill the few bases of a Minor-Ally it may also set up
  // in; then wherever it is allowed.
  const rest = f.setup.flatMap((r) => (r.kind === "rest-in" ? [resolveAreas(ctx, r.in).places] : []))[0];
  const own = territoryOf(ctx, owner).places;
  for (const s of poolSpecs(state, owner)) {
    for (let i = 0; i < s.count; i++) {
      const spec: UnitSpec = { type: s.type, strength: s.strength, ...(s.nationality ? { nationality: s.nationality } : {}) };
      if (!(rest && placeFirst(spec, (p) => rest.has(p))) && !placeFirst(spec, (p) => own.has(p)) && !placeFirst(spec)) {
        throw new AutoSetupError(STUCK, (u) => u.type === s.type);
      }
    }
  }
  act({ type: "SETUP_DONE", owner });
  return actions;
}

/**
 * A legal setup for every owner still to set up, not a good one. It exists so the game can start
 * before the computer opponent does (which will choose its own placements).
 */
export function autoSetup(ctx: GameContext, initial: GameState): Action[] {
  let state = initial;
  const all: Action[] = [];
  while (state.phase === "setup") {
    for (const a of autoSetupOwner(ctx, state)) {
      const r = applyAction(ctx, state, a);
      if (!r.ok) throw new AutoSetupError(r.error);
      state = r.state;
      all.push(a);
    }
  }
  return all;
}
