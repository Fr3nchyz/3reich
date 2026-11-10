import { applyAction, legalActions, type Action } from "../engine/actions";
import { sideToAct } from "../engine/actor";
import { counterAirOf } from "../engine/air-counter-wire";
import { dasOf } from "../engine/air-defense-wire";
import { portAttacksOf } from "../engine/air-port-wire";
import type { GameContext } from "../engine/context";
import type { GameState, Side } from "../engine/types";
import { placeName, unitName, unitsWithIds } from "./names";
import * as T from "./airText";

type PickAction = Extract<Action, { type: "DESIGNATE_DAS" | "DESIGNATE_DAS_INTERCEPT" }>;
export interface AirMissionDraft { target: string; units: readonly string[] }
export interface AirMissionChoice {
  target: string; place: string; committed: string[];
  chips: { id: string; text: string; chosen: boolean }[];
  factors: number; action: PickAction | null;
}
export interface AirMissionCard {
  title: string; note: string;
  assigned: { place: string; planes: string[] }[];
  choices: AirMissionChoice[];
  resolve: Action | null; pass: Action | null; passText: string;
}
export const airMissionKey = (s: GameState): string =>
  `${s.year}-${s.season}-${s.activeSide}-${s.position?.part === "player-turn" ? s.position.turn : ""}`;
const planeNames = (ctx: GameContext, s: GameState, ids: readonly string[]) => unitsWithIds(s, ids)
  .map(u => T.missionPlane(unitName(u), placeName(ctx.map, u.at)));

/** Spec 09 D3/D4, AER73/76/92; spec 12 R14: display only engine-listed work for the acting human.
 * The legal list supplies candidate planes; the engine validates a selected subset (as in the 7b card).
 * A dry run is pure, including interception dice; its result is discarded and never changes the game. */
export function airMissionModel(ctx: GameContext, s: GameState, side: Side, drafts: readonly AirMissionDraft[] = []): AirMissionCard | null {
  if (s.phase !== "player-turn" || s.position?.part !== "player-turn" || sideToAct(s) !== side) return null;
  const step = s.position.step;
  if (step !== "7c" && step !== "7d" && step !== "7e" && step !== "7i") return null;
  const legal = legalActions(ctx, s);
  const picks = legal.filter((a): a is PickAction => a.type === "DESIGNATE_DAS" || a.type === "DESIGNATE_DAS_INTERCEPT");
  const choices = picks.map(a => {
    const draft = drafts.find(d => d.target === a.hex);
    const selected = draft?.target === a.hex ? a.units.filter(id => draft.units.includes(id)) : a.units;
    const action = { ...a, units: selected };
    return { target: a.hex, place: placeName(ctx.map, a.hex), committed: planeNames(ctx, s, dasOf(s)[a.hex] ?? []),
      chips: a.units.map(id => ({ id, text: planeNames(ctx, s, [id])[0]!, chosen: selected.includes(id) })),
      factors: unitsWithIds(s, selected).reduce((n, u) => n + u.strength, 0),
      action: selected.length > 0 && applyAction(ctx, s, action).ok ? action : null };
  });
  const missions = step === "7c" ? counterAirOf(s) : step === "7i" ? portAttacksOf(s)
    : step === "7d" ? Object.entries(dasOf(s)).map(([target, units]) => ({ target, units })) : [];
  const resolve = legal.find(a => a.type === "RESOLVE_COUNTER_AIR" || a.type === "RESOLVE_PORT_ATTACKS") ?? null;
  const pass = legal.find(a => a.type === "END_STEP" && a.step === step) ?? null;
  // Spec 09 D3: with no useful designation, show only the legal way on if already at this step.
  return { title: T.MISSION_TITLES[step], note: T.MISSION_NOTES[step], choices,
    assigned: missions.map(m => ({ place: placeName(ctx.map, m.target), planes: planeNames(ctx, s, m.units) })),
    resolve, pass, passText: step === "7d" ? T.DAS_PASS : step === "7e" ? T.INTERCEPT_PASS : T.MISSION_CONTINUE };
}
