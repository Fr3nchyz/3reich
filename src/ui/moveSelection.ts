import type { GameContext } from "../engine/context";
import type { HexId } from "../engine/hex";
import { sideInWar } from "../engine/control";
import { moveOptionsFor, type MoveDestination } from "../engine/move-options";
import { hasMoved } from "../engine/move-record";
import { movableProblem, movementFactor } from "../engine/movement";
import type { GameState, Unit } from "../engine/types";
import { unitsWhere } from "./actionLabels";
import { placeName, stackSummary, unitName } from "./names";
import * as T from "./moveText";

/**
 * The Move card as plain data (spec 10, ticket 10-2): for one chosen hex and the units ticked in it, every counter as a line (ticked, free or
 * greyed with the reason), where the ticked units can go together (the yellow hexes), where a faster one could go further alone (the second
 * shade), and the sentences. Pure: it asks the engine's read-only `moveOptionsFor`, decides no rule, and never puts a unit id in a sentence
 * (the `key` of a line is for the list only). The caller keeps the ticks; this module returns the next set for each tap.
 */

export type Layer = "ground" | "air" | "naval" | "other";
export type LineState = "ticked" | "free" | "greyed";

/** The layers in the order the card lists them: the ground units first, since they are what is picked (decision 2). */
export const LAYERS: readonly Layer[] = ["ground", "air", "naval", "other"];
export const LAYER_TITLES: Readonly<Record<Layer, string>> = { ground: "Ground", air: "Air", naval: "Naval", other: "Other counters" };

export interface MoveLine {
  /** The unit id, a stable key for the list; never shown. */
  key: string;
  /** "3-4 German armor" (and ", held by Germany" for a counter of another nation). */
  name: string;
  layer: Layer;
  state: LineState;
  /** Greyed: why it stays. Free: "stays here". Ticked: null. */
  note: string | null;
  /** What a screen reader hears: "3-4 German armor, ticked" / ", not ticked" / ", does not move on the ground". */
  label: string;
}

export interface MoveSelection {
  hex: HexId;
  /** "Lodz (N33)". */
  title: string;
  lines: MoveLine[];
  /** The ticked units, in line order. */
  ticked: string[];
  /** How many units of the hex can be ticked (they can move now and have a hex to go to alone). */
  tickable: number;
  status: "ready" | "nothing-ticked" | "nowhere" | "nobody";
  /** "2 of 2 ticked." */
  summary: string;
  /** "Together they can go up to 3 hexes (set by the 2-3 German infantry)." Null unless the ticked units can go somewhere. */
  together: string | null;
  /** "The 3-4 German armor alone could go up to 4 hexes. Untick the 2-3 German infantry to let it go further." Null when no ticked unit would gain. */
  further: string | null;
  /** "1 hex within reach cannot take both of them." Null when every hex a ticked unit could end in alone takes them all. */
  room: string | null;
  /** The line under the list: the next thing to do. */
  advice: string;
  /** "Staying in Lodz (N33): 2-3 German infantry." Null when every unit that could move is ticked. */
  leftBehind: string | null;
  /** The polite line for a screen reader after each change. */
  announce: string;
  /** The yellow hexes: where all ticked units can end up together, with the path to each. */
  destinations: MoveDestination[];
  /** The second shade: hexes a ticked unit with more movement could reach alone but the group cannot. */
  alone: HexId[];
}

const idOrder = (u: Unit): number => Number(u.id.replace(/\D/g, ""));
const unitsIn = (state: GameState, hex: HexId): Unit[] => Object.values(state.units).filter((u) => u.at === hex).sort((a, b) => idOrder(a) - idOrder(b));

function layerOf(u: Unit): Layer {
  if (u.type === "infantry" || u.type === "armor" || u.type === "airborne" || u.type === "replacement") return "ground";
  return u.type === "air" || u.type === "airbase" ? "air" : u.type === "fleet" ? "naval" : "other";
}

/** Why the engine says this unit cannot move now, in words, or null if it can. */
function reasonFor(ctx: GameContext, state: GameState, u: Unit): string | null {
  if (movableProblem(ctx, state, u) === null) return null;
  const kind = T.cannotMoveReason(u.type);
  if (kind) return kind;
  if (sideInWar(state, u.owner) !== state.activeSide) return T.NOT_YOURS;
  return hasMoved(state, u.id) ? T.ALREADY_MOVED : T.CANNOT_NOW;
}

/** What each unit of the hex could reach alone, once per call; a greyed unit has nothing. */
function aloneOptions(ctx: GameContext, state: GameState, units: readonly Unit[]) {
  return new Map(
    units.map((u) => {
      const o = reasonFor(ctx, state, u) === null ? moveOptionsFor(ctx, state, [u.id]) : null;
      return [u.id, o && o.ok ? o : null] as const;
    }),
  );
}

/** The units of the hex that can be ticked: able to move now and with a hex to go to alone. */
const tickableIds = (alone: ReturnType<typeof aloneOptions>): string[] => [...alone].filter(([, o]) => o !== null && o.destinations.length > 0).map(([id]) => id);

/** The ticks a hex starts with: every unit that can move (decision 1). Empty when none can. */
export function defaultTicks(ctx: GameContext, state: GameState, hex: HexId): string[] {
  return tickableIds(aloneOptions(ctx, state, unitsIn(state, hex)));
}

/** One tap on a unit's line: the unit is unticked if ticked, ticked if not. The order is the list's. */
export const toggled = (ticked: readonly string[], id: string): string[] => (ticked.includes(id) ? ticked.filter((t) => t !== id) : [...ticked, id]);

/** The card for `hex` with these units ticked (ids that are not tickable units of the hex are ignored). */
export function selectionFor(ctx: GameContext, state: GameState, hex: HexId, tickedIds: readonly string[]): MoveSelection {
  const units = unitsIn(state, hex);
  const alone = aloneOptions(ctx, state, units);
  const tickable = tickableIds(alone);
  const ticked = units.map((u) => u.id).filter((id) => tickable.includes(id) && tickedIds.includes(id));
  const lines = units
    .map((u): MoveLine => {
      const can = tickable.includes(u.id);
      const lineState: LineState = !can ? "greyed" : ticked.includes(u.id) ? "ticked" : "free";
      const note = lineState === "ticked" ? null : lineState === "free" ? T.STAYS_HERE : (reasonFor(ctx, state, u) ?? T.NO_HEX_TO_GO_TO);
      const name = unitName(u, true);
      return { key: u.id, name, layer: layerOf(u), state: lineState, note, label: `${name}, ${note ?? "ticked"}` };
    })
    .sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer));
  const base = { hex, title: placeName(ctx.map, hex), lines, ticked, tickable: tickable.length, destinations: [] as MoveDestination[], alone: [] as HexId[], together: null, further: null, room: null, leftBehind: null };
  if (tickable.length === 0) return { ...base, status: "nobody", summary: T.NOTHING_CAN_MOVE, advice: "", announce: T.NOTHING_CAN_MOVE };
  const summary = T.tickedCount(ticked.length, tickable.length);
  const stay = units.filter((u) => tickable.includes(u.id) && !ticked.includes(u.id));
  const leftBehind = stay.length > 0 ? T.stayingSentence(base.title, stackSummary(stay, true)) : null;
  if (ticked.length === 0) return { ...base, status: "nothing-ticked", summary, advice: T.NOTHING_TICKED, leftBehind, announce: `${summary} ${T.NOTHING_TICKED}` };

  const group = moveOptionsFor(ctx, state, ticked);
  if (!group.ok || group.destinations.length === 0) return { ...base, status: "nowhere", summary, advice: T.NOWHERE_TOGETHER, leftBehind, announce: `${summary} ${T.NOWHERE_TOGETHER}` };
  const reached = new Set(group.destinations.map((d) => d.to));
  const tickedUnits = group.units;
  const slowest = tickedUnits.filter((u) => movementFactor(u) === group.points);
  // Further than the group, not merely a hex within its reach that is too full for all of them (that is told by `room`).
  const beyond = (u: Unit) => alone.get(u.id)!.destinations.map((d) => d.to).filter((h) => !reached.has(h) && !group.tooFull.includes(h));
  const faster = tickedUnits.filter((u) => movementFactor(u) > group.points && beyond(u).length > 0);
  const extra = new Set(faster.flatMap(beyond));
  const fits = new Set(ticked.flatMap((id) => alone.get(id)!.destinations.map((d) => d.to)));
  const crowded = ticked.length > 1 ? group.tooFull.filter((h) => fits.has(h)) : [];
  const further = faster.length > 0 ? `${T.furtherSentence(faster.map((u) => ({ name: unitName(u), points: movementFactor(u) })))} ${T.untickAdvice(slowest.map((u) => unitName(u)), faster.length)}` : null;
  return {
    ...base,
    status: "ready",
    summary,
    together: T.togetherSentence(tickedUnits.map((u) => unitName(u)), group.points, slowest.map((u) => unitName(u))),
    further,
    room: crowded.length > 0 ? T.roomSentence(crowded.length, ticked.length) : null,
    advice: T.tapToMove(ticked.length),
    leftBehind,
    announce: T.announceReady(ticked.length, tickable.length, group.points),
    destinations: group.destinations,
    alone: [...extra].sort(),
  };
}

/** "Moved 3-4 German armor from Lodz (N33) to Radom (N34)." Asked with the position from before the move (the counters still stand at the start). */
export const movedLine = (ctx: GameContext, before: GameState, unitIds: readonly string[], to: HexId): string => T.movedSentence(unitsWhere(ctx, before, unitIds), placeName(ctx.map, to));
