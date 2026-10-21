import { ADVANCE_AFTER_COMBAT, ONE_ATTACK_PER_HEX, attackNumbers, attackerPool, crossable, defendersAt, frontAllowsAttack, isEnemy, isGroundCombatUnit, lonersAt, neighborIds } from "../engine/attack-rules";
import { ODDS_COLUMNS, type OddsColumn } from "../engine/combat";
import { combatOf } from "../engine/combat-record";
import { committedAt } from "../engine/air-support";
import type { GameContext } from "../engine/context";
import { FLEETS_DISPLACED_ON_CAPTURE } from "../engine/naval-rules";
import { OWNER_NAMES } from "../engine/nations";
import type { DefenseBasis } from "../engine/terrain";
import type { GameState, Unit } from "../engine/types";
import { multipleWord, resultRows, type ResultRow } from "./attackResults";
import { nationAdjective, placeName, stackSummary, unitName } from "./names";

/**
 * The attack preview (spec 07, parts B and E): everything the attack card shows before the button, as plain data. A pure function of the
 * context, the state, the target hex and the ids of the chosen attackers: no DOM, no dice (it never reads or changes `rngState`) and no
 * rule of its own. Defenders, loners, who may attack, the odds and the terrain reason all come from the engine's own functions.
 */

export type { ResultRow } from "./attackResults";

export interface AttackerChip {
  id: string;
  /** "3-4 German armor". */
  name: string;
  /** "Lodz (N33)". */
  from: string;
  /** "1 of 2" when an identical counter stands in the same hex, so two chips can be told apart; otherwise null. */
  nth: string | null;
  strength: number;
  state: "chosen" | "free" | "greyed";
  /** Why a greyed unit cannot attack ("has already attacked this turn"); null otherwise. */
  reason: string | null;
}

export interface DefenderLine {
  id: string;
  name: string;
  strength: number;
}

export interface NonDefenderLine {
  id: string;
  name: string;
  reason: string;
}

/** One plane committed to the hex: "3-4 German air" from "Poznan (M33)". */
export interface AirPlane {
  name: string;
  from: string;
  strength: number;
}

/** The air committed to ground support at the hex (spec 09): what counts in the attack, and what is committed but left out by the cap. */
export interface AirSupportLine {
  /** One per unit that counts. */
  counted: AirPlane[];
  /** The air factors that count (they are inside `attackFactors`). */
  factors: number;
  /** Committed units the cap of three times the ground factors leaves out. */
  leftOut: AirPlane[];
}

export interface PreviewNumbers {
  /** Ground factors plus the air factors that count. */
  attackFactors: number;
  /** The air support inside `attackFactors`, or null when none is committed here. */
  air: AirSupportLine | null;
  /** The defenders' printed factors, before the terrain multiple. */
  defenseFactors: number;
  multiplier: number;
  basis: DefenseBasis;
  /** "plain country: doubled", "behind a river or crossing arrow: tripled (every attacker is across it)"... */
  multiplierReason: string;
  /** Defence factors times the multiplier: what the attack is measured against. */
  defenseTotal: number;
  /** null: weaker than 1-4, the attackers are eliminated with no roll. */
  column: OddsColumn | null;
  /** "7 against 4, column 1-1", or the no-roll sentence. */
  oddsText: string;
}

export interface Sweep {
  /** The counters destroyed with no roll (air units and the like; not fleets, which are driven out: `moved`). */
  destroyed: string[];
  /** The fleets driven out to a friendly port with no roll (spec 12 R9), or lost if no port has room. */
  moved: string[];
  text: string;
}

/** A source of extra factors or a column shift. Empty today: the engine has none (TODO(verify): whether the PC game has a column shift for a ground attack). */
export interface PreviewModifier {
  label: string;
  kind: "factors" | "column";
  amount: number;
}

export interface AttackButton {
  text: string;
  /** The column is worse than 1-1 (or there is no roll): the button is shown in amber text, no pop-up (spec 07 decision 1). */
  risky: boolean;
  disabled: boolean;
}

export interface AttackPreview {
  target: string;
  targetName: string;
  defenders: DefenderLine[];
  nonDefenders: NonDefenderLine[];
  attackers: AttackerChip[];
  /** null when no unit is chosen, or when the hex holds no ground defender (see `sweep`). */
  numbers: PreviewNumbers | null;
  /** One row per distinct result of the column, in the order of the first roll. Empty when there is no roll. */
  results: ResultRow[];
  /** Enemy counters that go too if the defenders are eliminated (computed with `lonersAt` on the position without them). */
  alsoDestroyed: string[];
  /** Enemy fleets that move to a friendly port instead if the defenders are eliminated (spec 12 R9). */
  alsoMoved: string[];
  /** Said when a unit added to or taken from the attack changes the defender's multiple. */
  riverWarnings: string[];
  sweep: Sweep | null;
  modifiers: PreviewModifier[];
  problems: string[];
  button: AttackButton;
  /** The line above the button, or null when the engine allows more attacks on the hex. */
  oneTry: string | null;
}

const MULTIPLIER_REASONS: Readonly<Record<DefenseBasis, string>> = {
  fortress: "fortress: quadrupled",
  mountains: "mountains: tripled",
  swamp: "swamp: tripled",
  "river-or-arrow": "behind a river or crossing arrow: tripled (every attacker is across it)",
  "beach-invasion": "beach against a seaborne invasion: tripled",
  plain: "plain country: doubled",
};

const RISKY: readonly OddsColumn[] = ODDS_COLUMNS.slice(0, ODDS_COLUMNS.indexOf("1-1"));

const NONE_CHOSEN = "No unit is chosen to attack.";

const atStep7h = (s: GameState): boolean => s.phase === "player-turn" && s.position?.part === "player-turn" && s.position.step === "7h";

interface Candidate {
  unit: Unit;
  reason: string | null;
}

/** Every ground unit of the side to move that stands next to the target, free to attack or with the reason it cannot. */
function candidatesFor(ctx: GameContext, state: GameState, target: string): Candidate[] {
  const spent = combatOf(state).attacked;
  return attackerPool(ctx, state, state.activeSide, [])
    .filter((u) => neighborIds(ctx, u.at).includes(target))
    .map((unit): Candidate => {
      if (spent.includes(unit.id)) return { unit, reason: "has already attacked this turn" };
      if (!crossable(ctx, unit.at, target)) return { unit, reason: "cannot attack across the hexside between the two hexes" };
      // The listing of `legalActions` only holds units that meet an enemy here, so a unit at war with nobody in the hex is not offered.
      if (defendersAt(state, [unit], target).length === 0 && lonersAt(state, [unit], target).length === 0) return { unit, reason: noTargetReason(state, unit, target) };
      return { unit, reason: null };
    });
}

/**
 * Why a unit has nothing to attack in the hex. The usual reason is that it is at war with nobody there; the other is that the only enemies
 * are air units or fleets, which a ground unit of any nation standing with them protects (`lonersAt`): then the card names that unit.
 */
function noTargetReason(state: GameState, unit: Unit, target: string): string {
  const here = Object.values(state.units).filter((u) => u.at === target);
  const guard = here.find(isGroundCombatUnit);
  if (guard && here.some((u) => !isGroundCombatUnit(u) && isEnemy(state, unit.owner, u.owner))) return `cannot attack here: the enemy air and fleet counters are protected by a ${nationAdjective(guard)} ground unit that stands with them and that you are not at war with`;
  return "is not at war with anyone in this hex";
}

/** "has already attacked" said of one counter, or of several ("have already attacked"). */
const plural = (reason: string): string => reason.replace(/^has /, "have ").replace(/^is /, "are ");

/** The sentences about chosen units that cannot attack: grouped by counter and reason, in agreement ("The 2-3 German infantry counter has ...", "2 of the 2-3 German infantry counters have ..."). */
function greyedProblems(chosen: readonly { unit: Unit; reason: string }[]): string[] {
  const groups = new Map<string, { name: string; reason: string; n: number }>();
  for (const { unit, reason } of chosen) {
    const key = `${unitName(unit)}|${reason}`;
    const g = groups.get(key) ?? { name: unitName(unit), reason, n: 0 };
    groups.set(key, { ...g, n: g.n + 1 });
  }
  return [...groups.values()].map((g) => (g.n === 1 ? `The ${g.name} counter ${g.reason}.` : `${g.n} x ${g.name} counters ${plural(g.reason)}.`));
}

/** "the unit next to it has already attacked this turn; the 2 units next to it are not at war with anyone in this hex". */
function reasonsIn(cands: readonly Candidate[]): string {
  const counts = new Map<string, number>();
  for (const c of cands) counts.set(c.reason!, (counts.get(c.reason!) ?? 0) + 1);
  return [...counts].map(([reason, n]) => (n === 1 ? `the unit next to it ${reason}` : `the ${n} units next to it ${plural(reason)}`)).join("; ");
}

/** The default choice (spec 07 decision 4): every unit that can attack; for a hex with only air units or the like, the weakest single unit, infantry first. */
export function defaultAttackers(ctx: GameContext, state: GameState, target: string): string[] {
  const free = candidatesFor(ctx, state, target).filter((c) => c.reason === null).map((c) => c.unit);
  if (free.length > 0 && defendersAt(state, free, target).length === 0) {
    const weakest = [...free].sort((a, b) => Number(a.type !== "infantry") - Number(b.type !== "infantry") || a.strength - b.strength || a.id.localeCompare(b.id))[0]!;
    return [weakest.id];
  }
  return free.map((u) => u.id);
}

function describeNumbers(ctx: GameContext, state: GameState, attackers: Unit[], defenders: Unit[], target: string): PreviewNumbers {
  const n = attackNumbers(ctx, state, attackers, defenders, target);
  const defenseTotal = n.defenseFactors * n.multiplier;
  const rounded = n.attackFactors < defenseTotal ? " A weaker attack is rounded against the attacker." : n.attackFactors >= 5 * defenseTotal ? " More than 5-1 counts as 5-1." : "";
  const committed = committedAt(state, target);
  const plane = (u: Unit): AirPlane => ({ name: unitName(u), from: placeName(ctx.map, u.at), strength: u.strength });
  const air: AirSupportLine | null = committed.length === 0 ? null : { counted: n.air.map(plane), factors: n.airFactors, leftOut: committed.filter((u) => !n.air.includes(u)).map(plane) };
  const mine = air && air.factors > 0 ? `${n.attackFactors} (${n.attackFactors - air.factors} on the ground and ${air.factors} in the air)` : `${n.attackFactors}`;
  const odds = n.column === null ? `${mine} against ${defenseTotal}: weaker than 1-4, so the attackers are eliminated with no roll.` : `${mine} against ${defenseTotal}, column ${n.column}.`;
  return { attackFactors: n.attackFactors, air, defenseFactors: n.defenseFactors, multiplier: n.multiplier, basis: n.basis, multiplierReason: MULTIPLIER_REASONS[n.basis], defenseTotal, column: n.column, oddsText: odds + rounded };
}

/** The problems that stop any attack on this hex now (the sentences of spec 07 part A). */
function hexProblems(ctx: GameContext, state: GameState, target: string, cands: Candidate[]): string[] {
  const rec = combatOf(state);
  if (!atStep7h(state)) return ["Attacks are made at step 7h."];
  if (rec.pending) return ["An Exchange is waiting for its losses to be chosen first."];
  if (ONE_ATTACK_PER_HEX && rec.targets.includes(target)) return ["This hex has already been attacked this turn."];
  const front = ctx.map.hexes[target]?.front;
  if (front && !frontAllowsAttack(ctx, state, state.activeSide, front)) return [`Your side may not attack on the ${front} front now.`];
  if (cands.length === 0) return ["None of your units that have not attacked is next to this hex."];
  const here = Object.values(state.units).filter((u) => u.at === target);
  if (here.length > 0 && !here.some((h) => cands.some((c) => isEnemy(state, c.unit.owner, h.owner)))) return [`You are not at war with ${OWNER_NAMES[here[0]!.owner]}.`];
  return [];
}

/** Notes on the multiplier: a unit added to or taken from the attack that changes it (the river bonus needs every attacker across the river). */
function riverWarnings(ctx: GameContext, state: GameState, cands: Candidate[], chosen: Unit[], defenders: Unit[], target: string): string[] {
  if (chosen.length === 0 || defenders.length === 0) return [];
  const now = attackNumbers(ctx, state, chosen, defenders, target).multiplier;
  const out: string[] = [];
  for (const { unit, reason } of cands) {
    if (reason !== null) continue;
    const isChosen = chosen.includes(unit);
    if (isChosen && chosen.length === 1) continue;
    const alt = isChosen ? chosen.filter((u) => u !== unit) : [...chosen, unit];
    const then = attackNumbers(ctx, state, alt, defenders, target).multiplier;
    if (then === now) continue;
    const who = `${unitName(unit)} from ${placeName(ctx.map, unit.at)}`;
    out.push(isChosen ? `Taking ${who} out of the attack gives the defenders the river bonus: ${multipleWord(now)} becomes ${multipleWord(then)}.` : `Adding ${who} cancels the river bonus: the defence goes from ${multipleWord(now)} to ${multipleWord(then)}.`);
  }
  return out;
}

const factorsWord = (n: number): string => `${n} factor${n === 1 ? "" : "s"}`;

/** What a roll-free attack does, in words: some counters are destroyed, enemy fleets are driven out to a friendly port. */
function sweepText(destroyed: readonly string[], moving: readonly string[]): string {
  const gone = destroyed.length === 0 ? "" : ` ${destroyed.length === 1 ? "This counter is" : `These ${destroyed.length} counters are`} destroyed: ${destroyed.join(", ")}.`;
  const out = moving.length === 0 ? "" : ` ${moving.length === 1 ? "This fleet" : "These fleets"} must leave and move to the nearest friendly port with room, or ${moving.length === 1 ? "is" : "are"} lost if there is none: ${moving.join(", ")}.`;
  return `No roll.${gone}${out}`;
}

function buttonFor(place: string, chosen: Unit[], numbers: PreviewNumbers | null, sweep: Sweep | null, loners: Unit[], moving: Unit[], problems: string[]): AttackButton {
  if (problems.length > 0) return { text: chosen.length === 0 && problems.length === 1 && problems[0] === NONE_CHOSEN ? "Choose at least one unit to attack with" : problems[0]!, risky: false, disabled: true };
  if (sweep) {
    const rest = loners.filter((u) => !moving.includes(u));
    const text = rest.length === 0 ? `Drive ${stackSummary(moving)} out of ${place}` : moving.length === 0 ? `Destroy ${stackSummary(rest)} in ${place}` : `Destroy ${stackSummary(rest)} in ${place} and drive ${stackSummary(moving)} out`;
    return { text, risky: false, disabled: false };
  }
  const airNote = numbers!.air && numbers!.air.factors > 0 ? ` and ${numbers!.air.factors} air` : "";
  const by = `with ${chosen.length === 1 ? "1 unit" : `${chosen.length} units`}${airNote} (${factorsWord(numbers!.attackFactors)})`;
  // With no roll the loss is certain, which is not a gamble: the amber warning stays, the word "risky" does not.
  if (numbers!.column === null) return { text: `Attack ${place} ${by}: no roll, your attackers are eliminated (certain loss)`, risky: true, disabled: false };
  const risky = RISKY.includes(numbers!.column);
  return { text: risky ? `Attack ${place} ${by} at ${numbers!.column} (risky)` : `Attack ${place} ${by}`, risky, disabled: false };
}

export function attackPreview(ctx: GameContext, state: GameState, target: string, chosenIds: readonly string[]): AttackPreview {
  const place = placeName(ctx.map, target);
  const cands = ctx.map.hexes[target] ? candidatesFor(ctx, state, target) : [];
  const problems = ctx.map.hexes[target] ? hexProblems(ctx, state, target, cands) : [`${target} is not a hex on the map.`];
  const free = cands.filter((c) => c.reason === null).map((c) => c.unit);
  const chosen = free.filter((u) => chosenIds.includes(u.id));
  const stuck: { unit: Unit; reason: string }[] = [];
  for (const id of problems.length > 0 ? [] : chosenIds) {
    const u = state.units[id];
    const c = cands.find((x) => x.unit.id === id);
    if (u && c?.reason) stuck.push({ unit: u, reason: c.reason });
    else if (u && !c) problems.push(`The ${unitName(u)} counter is not next to ${place}.`);
  }
  problems.push(...greyedProblems(stuck));
  // Nothing next to the hex can attack it: say the real reason (counted by reason), not "choose a unit".
  if (problems.length === 0 && free.length === 0) problems.push(`Nothing can attack ${place} now: ${reasonsIn(cands)}.`);
  if (chosen.length === 0 && problems.length === 0) problems.push(NONE_CHOSEN);

  // Before anything is chosen the hex is described as seen by everyone who could attack.
  const scope = chosen.length > 0 ? chosen : free;
  const defenders = defendersAt(state, scope, target);
  const loners = defenders.length === 0 ? lonersAt(state, scope, target) : [];
  if (chosen.length > 0 && defenders.length === 0 && loners.length === 0 && problems.length === 0) problems.push("The chosen units are not at war with anyone in this hex.");
  const here = Object.values(state.units).filter((u) => u.at === target);
  const nonDefenders = here
    .filter((u) => !defenders.includes(u) && !loners.includes(u))
    .map((u): NonDefenderLine => ({ id: u.id, name: unitName(u, true), reason: isGroundCombatUnit(u) ? "is not at war with your attackers" : "does not defend" }));
  const fleetsMove = (us: readonly Unit[]) => us.filter((u) => FLEETS_DISPLACED_ON_CAPTURE && u.type === "fleet");
  const moving = fleetsMove(loners);
  const swept = loners.filter((u) => !moving.includes(u)).map((u) => unitName(u, true));
  const sweep: Sweep | null = loners.length > 0 ? { destroyed: swept, moved: moving.map((u) => unitName(u, true)), text: sweepText(swept, moving.map((u) => unitName(u, true))) } : null;

  const numbers = chosen.length > 0 && defenders.length > 0 ? describeNumbers(ctx, state, chosen, defenders, target) : null;
  const without = { ...state, units: Object.fromEntries(Object.entries(state.units).filter(([id]) => !defenders.some((d) => d.id === id))) };
  const after = defenders.length > 0 && chosen.length > 0 ? lonersAt(without, chosen, target) : [];
  const alsoDestroyed = after.filter((u) => !fleetsMove(after).includes(u)).map((u) => unitName(u, true));
  const alsoMoved = fleetsMove(after).map((u) => unitName(u, true));
  const emptyAfterWin = ADVANCE_AFTER_COMBAT && here.every((u) => defenders.includes(u) || lonersAt(without, chosen, target).includes(u));
  // The air that counts fights and can be lost with the attackers (attack-losses.ts), so the rows are worked out with it among them.
  const airUnits = numbers && numbers.air && numbers.air.factors > 0 ? attackNumbers(ctx, state, chosen, defenders, target).air : [];
  const results = numbers?.column ? resultRows({ column: numbers.column, attackers: [...chosen, ...airUnits], defenders, multiplier: numbers.multiplier, alsoDestroyed, alsoMoved, emptyAfterWin }) : [];

  const keys = new Map<string, number>();
  const nth = cands.map((c) => `${unitName(c.unit)}|${c.unit.at}`);
  nth.forEach((k) => keys.set(k, (keys.get(k) ?? 0) + 1));
  const seen = new Map<string, number>();
  const attackers = cands.map((c, i): AttackerChip => {
    const total = keys.get(nth[i]!)!;
    const index = (seen.get(nth[i]!) ?? 0) + 1;
    seen.set(nth[i]!, index);
    const chip = c.reason ? "greyed" : chosen.includes(c.unit) ? "chosen" : "free";
    return { id: c.unit.id, name: unitName(c.unit), from: placeName(ctx.map, c.unit.at), nth: total > 1 ? `${index} of ${total}` : null, strength: c.unit.strength, state: chip, reason: c.reason };
  });

  return {
    target,
    targetName: place,
    defenders: defenders.map((u) => ({ id: u.id, name: unitName(u, true), strength: u.strength })),
    nonDefenders,
    attackers,
    numbers,
    results,
    alsoDestroyed,
    alsoMoved,
    riverWarnings: riverWarnings(ctx, state, cands, chosen, defenders, target),
    sweep,
    modifiers: [],
    problems,
    button: buttonFor(place, chosen, numbers, sweep, loners, moving, problems),
    oneTry: ONE_ATTACK_PER_HEX ? "One try: this hex cannot be attacked again this turn." : null,
  };
}
