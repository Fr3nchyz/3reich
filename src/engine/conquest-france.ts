import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { controllerOf } from "./control";
import { removeUnits } from "./conquest-forces";
import { routeLosses } from "./losses";
import { sideOfOwner } from "./setup";
import type { FallPlan } from "./conquest-stages";
import type { HexId } from "./hex";
import { baseSuits, stackingProblem } from "./placement";
import { rollD6 } from "./rng";
import type { ForcePools, ForceOwner, GameState, Unit, UnitType } from "./types";

/**
 * What is particular to the fall of France (spec 14 R5, ticket 14-7; Ref 18.3, 35.0; PC README rule 49.6). France is conquered like any Major Power
 * (`fall`, conquest.ts: its capital Paris is held by the enemy at the end of the Allied Combat Phase), and on top of that, at the same moment:
 *
 *  1. Vichy France is created: the Vichy hexes of European France (the zone `vichy-france` and Corsica) become Vichy-controlled; the rest of European
 *     France passes to the conqueror like the rest of the land France held (TODO(verify) V15: all of it, the Free French supply exception is not built).
 *  2. The French units in European France are halved: half, rounded up, of each kind of ground counter, and air and naval factors each totalled and
 *     halved, become Vichy and are set up in the Vichy hexes; the rest are lost with France (TODO(verify) V13, V38).
 *  3. Two dice decide the colonies, Lebanon-Syria first, then Tunisia-Algeria-Morocco: even, the colony's French units and the hexes France holds there
 *     become Vichy; odd, Free French (TODO(verify) V14, V40). The dice are always rolled, whoever holds the colony (a colony held by the Axis has no
 *     French hex or unit left to change).
 *  4. British units in Vichy territory are eliminated (README rule 49.6; TODO(verify) V39).
 *  5. France becomes a nation with status "vichy" and no BRPs, Vichy France an inactive German Minor-Ally (`franceMark`).
 *
 * These are the `before` and `after` steps and the `mark` of the plan that `fall()` builds for France (conquest-stages.ts): the halving runs before the
 * stages so that the Vichy half is no longer France's when they remove the rest, the report comes after them so that the log reads in order.
 */

/** The scenario zones that are the Vichy hexes of European France: Vichy France without Corsica (VICHY42.CON), then Corsica. */
export const VICHY_ZONE_IDS: readonly string[] = ["vichy-france", "corsica"];

/** The two colonies the dice decide: the map countries that make up each (TODO(verify) V14: "Tunisia-Algeria-Morocco" is one colony). */
export const FRENCH_COLONIES = [
  { id: "lebanon-syria", countries: ["lebanon-syria"] },
  { id: "north-africa", countries: ["tunisia", "algeria", "morocco"] },
] as const;

/** The Vichy hexes of European France, in the order of the zones (map order): the places the Vichy half is set up. */
export function vichyHexes(ctx: GameContext): HexId[] {
  const out: HexId[] = [];
  for (const id of VICHY_ZONE_IDS) for (const h of ctx.scenario.zones[id]?.hexes ?? []) if (ctx.map.hexes[h]?.land && !out.includes(h)) out.push(h);
  return out;
}

const idNumber = (u: Pick<Unit, "id">): number => Number(u.id.replace(/\D/g, ""));
const byId = (a: Unit, b: Unit): number => idNumber(a) - idNumber(b);

/** The ground counters: each kind (type, strength, movement) is halved by number. */
const COUNTED: readonly UnitType[] = ["infantry", "armor", "airborne", "replacement"];
/** Air and fleets: all the factors of the type are totalled and halved. */
const FACTORED: readonly UnitType[] = ["air", "fleet"];

/**
 * Half of French counters become Vichy (TODO(verify) V13, V38). Ground counters: half, rounded up, of each kind, the lowest unit numbers first. Air, and
 * fleets: the factors of all the counters of the type are totalled and half of the total, rounded up, is the least that Vichy gets; counters are taken in
 * unit-number order until their factors reach it. Anything else (airbases, bridgeheads) is lost.
 */
export function halve(units: readonly Unit[]): { keep: Unit[]; lose: Unit[] } {
  const keep: Unit[] = [];
  const sorted = [...units].sort(byId);
  const kinds = new Map<string, Unit[]>();
  for (const u of sorted.filter((x) => COUNTED.includes(x.type))) {
    const k = `${u.type}:${u.strength}:${u.movement ?? ""}`;
    kinds.set(k, [...(kinds.get(k) ?? []), u]);
  }
  for (const group of kinds.values()) keep.push(...group.slice(0, Math.ceil(group.length / 2)));
  for (const type of FACTORED) {
    const group = sorted.filter((u) => u.type === type);
    const wanted = Math.ceil(group.reduce((n, u) => n + u.strength, 0) / 2);
    let have = 0;
    for (const u of group) {
      if (have >= wanted) break;
      keep.push(u);
      have += u.strength;
    }
  }
  return { keep, lose: sorted.filter((u) => !keep.includes(u)) };
}

/** The land hexes of a colony. */
const colonyHexes = (ctx: GameContext, countries: readonly string[]): HexId[] =>
  Object.values(ctx.map.hexes).filter((h) => h.land && h.country !== undefined && countries.includes(h.country)).map((h) => h.id);

/**
 * Sets the kept counters up in the Vichy hexes, in map order, each in the first hex that suits it (a base for air and fleets), has room under the stacking
 * limits and holds no Allied counter (TODO(verify) V13, V38). A counter with no such hex is lost. The counters leave France and keep their numbers.
 */
function setUp(ctx: GameContext, state: GameState, keep: readonly Unit[], hexes: readonly HexId[]): { state: GameState; placed: number } {
  const moving = new Set(keep.map((u) => u.id));
  let units = Object.fromEntries(Object.entries(state.units).filter(([id]) => !moving.has(id)));
  let placed = 0;
  for (const u of keep) {
    const spec = { type: u.type, strength: u.strength };
    const at = hexes.find((h) => {
      const here = Object.values(units).filter((o) => o.at === h);
      return baseSuits(ctx, u.type, h) && stackingProblem(ctx, { ...state, units }, "vichy-france", spec, h) === null && !here.some((o) => sideOfOwner(o.owner) === "allies");
    });
    if (at === undefined) continue; // no room: lost with France
    units = { ...units, [u.id]: { ...u, owner: "vichy-france", at } };
    placed++;
  }
  // the lost counters stay France's where they were, for the stages to remove
  for (const u of keep) if (units[u.id] === undefined) units[u.id] = u;
  return { state: { ...state, units }, placed };
}

const emptyPool = (): ForcePools => ({ forcePool: [], allowableBuilds: [] });

/**
 * The nation records after France's fall: France has status "vichy" and no BRPs, exactly as the 1942 scenario has it (Ref 35.0; its Base goes too, so the
 * Year Start Sequence gives it nothing: it is not "gone", the declaration rules skip a "vichy" nation by name; TODO(verify) V41); Vichy France is an inactive
 * German Minor-Ally that never pays Germany BRPs; the Vichy and Free French have a Force Pool of their own, empty (TODO(verify) V40: nothing can be built for
 * them yet).
 */
export function franceMark(state: GameState): GameState {
  const france = state.nations.france;
  const pools = { ...state.pools };
  for (const owner of ["vichy-france", "free-france"] as const) pools[owner] ??= emptyPool();
  return {
    ...state,
    nations: { ...state.nations, france: { ...france, status: "vichy", brpBase: 0, brpTotal: 0, spendLimit: 0, spent: 0 } },
    minorAllies: [...state.minorAllies.map((m) => (m.of === "france" && m.active ? { ...m, active: false } : m)), ...(state.minorAllies.some((m) => m.owner === "vichy-france") ? [] : [{ owner: "vichy-france" as const, of: "germany" as const, active: false }])],
    pools,
  };
}

/** What the two steps share: `before` fills it in, `after` writes it down. */
interface Report {
  kept: number;
  lost: number;
  colonies: Extract<GameEvent, { type: "VICHY_CREATED" }>["colonies"];
  eliminated: Unit[];
  /** The routing event of each British unit eliminated (losses.ts), by unit id. */
  routed: Map<string, GameEvent[]>;
  vichy: HexId[];
  free: HexId[];
}

/**
 * The `before` and `after` steps of France's fall (see the top of this file). One pair per fall: `before` keeps what it did for `after` to report.
 */
export function franceSteps(): Pick<FallPlan, "before" | "after"> {
  const report: Report = { kept: 0, lost: 0, colonies: [], eliminated: [], routed: new Map(), vichy: [], free: [] };
  return {
    before: (ctx, state) => {
      let s = state;
      // 3. the colony dice, Lebanon-Syria first (TODO(verify) V14, V40: always both; only what France holds there changes)
      const control = { ...s.control };
      let rng = s.rngState;
      const owners = new Map<string, ForceOwner>();
      for (const colony of FRENCH_COLONIES) {
        const rolled = rollD6(rng);
        rng = rolled.state;
        const becomes = rolled.roll % 2 === 0 ? "vichy" : "free-french";
        const owner: ForceOwner = becomes === "vichy" ? "vichy-france" : "free-france";
        report.colonies.push({ colony: colony.id, die: rolled.roll, becomes });
        for (const hex of colonyHexes(ctx, colony.countries)) {
          owners.set(hex, owner);
          if (controllerOf(ctx, s, hex) === "france") {
            control[hex] = owner;
            (becomes === "vichy" ? report.vichy : report.free).push(hex);
          }
        }
      }
      // 1. the Vichy hexes of European France, whoever holds them (TODO(verify) V39)
      const zone = vichyHexes(ctx);
      for (const hex of zone) if (control[hex] !== "vichy-france") { control[hex] = "vichy-france"; report.vichy.push(hex); }
      const units = Object.fromEntries(Object.entries(s.units).map(([id, u]) => [id, u.owner === "france" && owners.has(u.at) ? { ...u, owner: owners.get(u.at)! } : u]));
      s = { ...s, control, units, rngState: rng };
      // 4. British units in Vichy territory (Vichy colonies included) are eliminated
      const territory = new Set<HexId>([...zone, ...report.vichy]);
      const british = Object.values(s.units).filter((u) => u.owner === "britain" && territory.has(u.at));
      s = removeUnits(s, british.map((u) => u.id)).state;
      report.eliminated = british;
      for (const u of british) { // each back to the British pool, or lost for good (losses.ts, spec 17 R1); the events are written by `after`
        const routed = routeLosses(s, [u]);
        s = routed.state;
        report.routed.set(u.id, routed.events);
      }
      // 2. the French units of European France are halved; the Vichy half is set up in the Vichy hexes
      const european = Object.values(s.units).filter((u) => u.owner === "france" && ctx.map.hexes[u.at]?.country === "france" && ctx.map.hexes[u.at]?.land);
      const halves = halve(european);
      const set = setUp(ctx, s, halves.keep, zone);
      report.kept = set.placed;
      report.lost = european.length - set.placed;
      return { state: set.state, events: [] };
    },
    after: (_ctx, state) => ({
      state,
      events: [
        { type: "VICHY_CREATED", halved: { kept: report.kept, lost: report.lost }, colonies: report.colonies, britishEliminated: report.eliminated.length },
        ...(report.vichy.length > 0 ? [{ type: "CONTROL_PASSED", country: "france", to: "vichy-france", hexes: [...report.vichy].sort() } satisfies GameEvent] : []),
        ...(report.free.length > 0 ? [{ type: "CONTROL_PASSED", country: "france", to: "free-france", hexes: [...report.free].sort() } satisfies GameEvent] : []),
        ...report.eliminated.flatMap((u): GameEvent[] => [{ type: "UNIT_ELIMINATED", unitId: u.id, owner: u.owner, at: u.at }, ...(report.routed.get(u.id) ?? [])]),
      ],
    }),
  };
}
