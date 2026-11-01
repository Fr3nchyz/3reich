import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { isConquered } from "../engine/conquest-record";
import type { HexId } from "../engine/hex";
import { minorForceEntries } from "../engine/minors";
import { sleepingAlly, sleepingAllyOfHex } from "../engine/minors-axis";
import { declarationCost, minorDeclarationProblem } from "../engine/minors-declare";
import { MINOR_COUNTRIES } from "../engine/minors-ids";
import { applyMinorPlacement, legalMinorPlacements, type MinorPlacement } from "../engine/minors-place";
import { capitalOf, minorValue } from "../engine/minors-rules";
import { combatantName } from "../engine/nations";
import type { GameState, MinorCountry, PowerId, Side } from "../engine/types";

type DeclareAction = Extract<Action, { type: "DECLARE_WAR" }>;
type PlaceAction = Extract<Action, { type: "PLACE_MINOR_FORCES" }>;

/** Spec 15 R1/R2/R4, D1: blocked rows remain inspectable; only supplied legal actions enable confirmation. */
export function minorDeclareModel(ctx: GameContext, state: GameState, by: PowerId,
  minor: MinorCountry, actions: readonly Action[]) {
  const name = combatantName(minor);
  const cost = declarationCost(ctx, state, by, minor);
  const army = minorForceEntries(minor);
  const totals = new Map<string, number>();
  for (const e of army) totals.set(e.type, (totals.get(e.type) ?? 0) + e.count * e.strength);
  const action = actions.find((a): a is DeclareAction => a.type === "DECLARE_WAR" && a.by === by && a.on === minor);
  const record = state.countries?.[minor];
  const status = record?.closedTo?.includes(by) ? "closed to you: a German garrison"
    : sleepingAlly(state, minor) ? "sleeping ally of Germany" : record?.status ?? "neutral";
  const reason = action ? null : minorDeclarationProblem(ctx, state, by, minor) ?? "You cannot declare war now or afford the price within your spending limit.";
  return {
    minor, name, group: "Small countries", cost, value: minorValue(minor), status,
    forces: army, summary: army.length ? [...totals].map(([type, n]) => `${n} ${type} factor${n === 1 ? "" : "s"}`).join(", ") : "No army.",
    text: minor === "persia" && record?.opened ? "Persia is open to the Axis: no declaration."
      : `Declare war on ${name} for ${cost} BRPs? This turn you must move a unit into ${name} or attack it. If you cannot, the declaration is cancelled and the ${cost} BRPs are lost.`,
    reason, buttons: [{ text: "Declare war", action: action ?? null, disabled: !action }, { text: "Cancel" }],
  };
}

/** Spec 15 R3/R9/R16, D2/D5: draft is local data; Done validates the entire army atomically in the engine. */
export function minorPlacementModel(ctx: GameContext, state: GameState, side: Side,
  actions: readonly Action[], draft: readonly MinorPlacement[] = []) {
  const offered = actions.find((a): a is PlaceAction => a.type === "PLACE_MINOR_FORCES" && a.side === side);
  if (!offered) return null;
  const minor = offered.minor;
  const name = combatantName(minor);
  const attacker = state.countries?.[minor]?.attacker;
  const capital = capitalOf(ctx, minor);
  const counters = minorForceEntries(minor).flatMap((e) => Array.from({ length: e.count }, () => e));
  const checked = applyMinorPlacement(ctx, state, minor, draft);
  const chips = counters.map((e, index) => {
    // R3/MC1: reserve the other draft counters when asking the engine for this chip's destinations.
    const units = { ...state.units };
    counters.forEach((other, i) => {
      const p = draft[i];
      if (i !== index && p && p.type === other.type && p.strength === other.strength) {
        const id = `minor-draft-${i}`;
        units[id] = { id, owner: minor, type: p.type, strength: p.strength, at: p.at };
      }
    });
    const choices = legalMinorPlacements(ctx, { ...state, units }, minor).find((c) => c.type === e.type && c.strength === e.strength);
    return { index, type: e.type, strength: e.strength, movement: e.movement,
      at: draft[index]?.at ?? null, hexes: choices?.hexes ?? [] };
  });
  const action: PlaceAction | null = checked.ok ? { ...offered, placements: draft.map((p) => ({ ...p })) } : null;
  return {
    minor, side, title: attacker ? `${combatantName(attacker)} attacked ${name}. Place ${name}'s army.`
      : `${name} joins Germany. Place ${name}'s army.`,
    hint: `At least one ground unit must stand in ${capital ? ctx.map.hexes[capital]?.name ?? capital : name}.`,
    chips, problem: checked.ok ? null : checked.error,
    buttons: [{ text: "Place automatically", action: { ...offered, placements: offered.placements.map((p) => ({ ...p })) }, disabled: false },
      { text: "Done", action, disabled: !action }],
  };
}

/** Spec 15 R4, D1: a red duty chip persists only while the record carries an unmet duty. */
export function minorDutyMarks(state: GameState) {
  return MINOR_COUNTRIES.flatMap((minor) => state.countries?.[minor]?.duty ? [{
    minor, tone: "red" as const, text: `${combatantName(minor)}: enter or attack this turn`,
  }] : []);
}

/** Spec 15 R2/R7/R9/R10, D3/D5: plain hex-card lines and map tint/capital marker; no map binding. */
export function minorHexModel(ctx: GameContext, state: GameState, hex: HexId) {
  const country = ctx.map.hexes[hex]?.country;
  const minor = MINOR_COUNTRIES.find((c) => c === country);
  if (!minor) return null;
  // Spec 15 R7/D4: conquered-country cards and map colouring belong to spec 14.
  if (isConquered(state, minor)) return null;
  const name = combatantName(minor);
  const record = state.countries?.[minor];
  const asleep = sleepingAllyOfHex(ctx, state, hex) === minor;
  const lines: string[] = [];
  if (record?.attacker && record.status !== "neutral") lines.push(`${name} is at war with ${combatantName(record.attacker)}.`);
  if (asleep) lines.push(`${name} sleeps. It joins Germany in Summer 1941. German units may enter.`);
  return { minor, lines, tint: asleep ? "axis-light" as const : null,
    marker: asleep && capitalOf(ctx, minor) === hex ? "asleep" as const : null };
}
