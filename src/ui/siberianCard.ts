import type { Action } from "../engine/actions";
import { SIBERIAN_QUOTAS, siberianPool, siberianTakenNow } from "../engine/siberian";
import type { GameState, UnitType } from "../engine/types";
import { turnKey } from "../engine/victory";
import { siberianCitiesLine, siberianLeftLine, SIBERIAN_TEXT } from "./endText";
import { escape } from "./mapGeometry";
import { counterNumber } from "./mapStyle";
import { counterIcon } from "./mapSymbols";
import { placeName } from "./names";
import type { Session } from "./session";

/**
 * The Free Siberian Transfer on the screen (spec 14, part D6; ticket 14-18): the card of step 8a for a human Allied player. The model has no DOM and no rule: the units and the
 * cities on offer are the engine's own `SIBERIAN_TRANSFER` actions (the armor rule and the stacking limit are theirs), the counts are the record's (`GameState.siberian`),
 * and every sentence is in `endText.ts`. A chip picks a counter, a city button (or a tap on a yellow hex of the map) takes it; the step is left with the engine's own
 * `END_STEP`, drawn as the card's one button ("Do not take any" until something is taken, then "Done taking units").
 */

type Transfer = Extract<Action, { type: "SIBERIAN_TRANSFER" }>;

export interface SiberianChip {
  key: string;
  type: UnitType;
  strength: number;
  /** The numbers printed on the counter ("3-3"). */
  numbers: string;
  /** How many of it the pool still holds. */
  inPool: number;
  /** Whether the engine offers it now (armor only once the infantry taken at least equal it). */
  allowed: boolean;
  chosen: boolean;
}

export interface SiberianCardModel {
  /** "You may take 3 more units this turn (4 in Winter 1941; 1 taken)." */
  leftLine: string;
  /** The first unit taken has switched the victory tables. */
  used: boolean;
  chips: SiberianChip[];
  /** The counter picked, and the cities it may go in (name and hex). */
  picked: { counter: string; cities: { hex: string; name: string }[] } | null;
  /** Nothing is taken yet this Game Turn: the closing button says "Do not take any". */
  untouched: boolean;
  /** No more may be taken this Game Turn. */
  finished: boolean;
}

const keyOf = (type: UnitType, strength: number): string => `${type}:${strength}`;
export const parseSiberianKey = (key: string): { type: UnitType; strength: number } => {
  const [type, strength] = key.split(":");
  return { type: type as UnitType, strength: Number(strength) };
};

/** Whether the card is drawn: a human Allied player at step 8a in a Game Turn that has a Transfer. */
export function siberianShown(s: Session): boolean {
  const { state } = s;
  const at8a = state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step === "8a" && state.activeSide === "allies";
  return at8a && !s.watch && s.humanSide === "allies" && SIBERIAN_QUOTAS[turnKey(state)] !== undefined;
}

/** The card for the position, from the legal actions on offer; null when it is not drawn. */
export function siberianModel(s: Session, actions: readonly Action[]): SiberianCardModel | null {
  if (!siberianShown(s)) return null;
  const { state } = s;
  const offered = actions.filter((a): a is Transfer => a.type === "SIBERIAN_TRANSFER");
  const quota = SIBERIAN_QUOTAS[turnKey(state)]!;
  const taken = siberianTakenNow(state);
  const takenNow = taken.infantry + taken.armor;
  const pool = new Map<string, { type: UnitType; strength: number; movement?: number; count: number }>();
  for (const e of siberianPool(state)) {
    const k = keyOf(e.type, e.strength);
    const have = pool.get(k);
    if (have) have.count += e.count;
    else pool.set(k, { type: e.type, strength: e.strength, ...(e.movement !== undefined ? { movement: e.movement } : {}), count: e.count });
  }
  const chips = [...pool.values()].map((p): SiberianChip => ({
    key: keyOf(p.type, p.strength),
    type: p.type,
    strength: p.strength,
    numbers: counterNumber({ strength: p.strength, ...(p.movement !== undefined ? { movement: p.movement } : {}) }),
    inPool: p.count,
    allowed: offered.some((a) => a.unit.type === p.type && a.unit.strength === p.strength),
    chosen: s.siberian !== null && s.siberian !== undefined && s.siberian.type === p.type && s.siberian.strength === p.strength,
  }));
  const pick = chips.find((c) => c.chosen && c.allowed);
  return {
    leftLine: siberianLeftLine(quota - takenNow, quota, { year: state.year, season: state.season }),
    used: state.siberian?.used === true,
    chips,
    picked: pick
      ? { counter: `${pick.numbers} ${pick.type}`, cities: offered.filter((a) => a.unit.type === pick.type && a.unit.strength === pick.strength).map((a) => ({ hex: a.at, name: placeName(s.ctx.map, a.at) })) }
      : null,
    untouched: takenNow === 0,
    finished: quota - takenNow <= 0,
  };
}

/** The label of the card's closing button (also the label of that `END_STEP` wherever it is listed): "Do not take any" until something is taken. */
export function siberianEndLabel(state: GameState): string {
  const taken = siberianTakenNow(state);
  return taken.infantry + taken.armor === 0 ? SIBERIAN_TEXT.none : SIBERIAN_TEXT.done;
}

/** The card as HTML; `endButton` is the HTML of the engine's `END_STEP` button for step 8a (drawn by the status view), shown as the card's one closing button. */
export function siberianCardHtml(s: Session, actions: readonly Action[], endButton: string): string {
  const m = siberianModel(s, actions);
  if (!m) return "";
  const chip = (c: SiberianChip) =>
    `<button type="button" data-siberian="${c.key}" aria-pressed="${c.chosen}"${c.allowed ? "" : ' disabled aria-disabled="true"'}>${counterIcon(c.type)} ${escape(c.numbers)}<br><small>${c.inPool} in the pool${c.allowed ? "" : ` &middot; ${SIBERIAN_TEXT.armorFirst}`}</small></button>`;
  const hint = m.finished ? SIBERIAN_TEXT.allTaken : m.chips.some((c) => c.allowed) ? SIBERIAN_TEXT.pick : "";
  const cities = m.picked
    ? `<p class="siberian-line">${escape(siberianCitiesLine(m.picked.counter))}</p><div class="siberian-cities">${m.picked.cities.map((c) => `<button type="button" data-siberian-city="${c.hex}">${escape(c.name)}</button>`).join("")}</div>`
    : "";
  return `<section class="siberiancard" id="siberian-card" aria-labelledby="siberian-title">
      <h2 id="siberian-title" tabindex="-1">${escape(SIBERIAN_TEXT.title)}</h2>
      <p class="siberian-line">${escape(m.leftLine)}</p>
      <p class="siberian-line">${escape(SIBERIAN_TEXT.intro)}</p>
      <p class="siberian-line">${escape(SIBERIAN_TEXT.armorNote)} ${escape(m.used ? SIBERIAN_TEXT.raised : SIBERIAN_TEXT.raises)}</p>
      ${m.chips.length > 0 ? `<div class="chips" role="group" aria-label="Counters in the Russian pool">${m.chips.map(chip).join("")}</div>` : ""}
      ${hint ? `<p class="siberian-line">${escape(hint)}</p>` : ""}${cities}
      <div class="siberian-buttons">${endButton}</div>
    </section>`;
}
