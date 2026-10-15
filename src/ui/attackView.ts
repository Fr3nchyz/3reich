import type { Action } from "../engine/actions";
import { attackPreview, defaultAttackers, type AttackerChip, type AttackPreview, type ResultRow } from "./attackPreview";
import { attackTargets } from "./attackDraft";
import { defendersLine, nonDefendersLine, rowLines, toBeatLine } from "./attackText";
import { atStep7h, attacking } from "./attackTap";
import { choiceHtml } from "./choiceView";
import { escape } from "./mapGeometry";
import { resultCardHtml } from "./resultView";
import type { Session } from "./session";

/**
 * The attack list and the attack card of step 7h (spec 07, part B) as HTML, drawn from the preview model. Everything is a button with a stable
 * data-* key (data-target, data-unit) or an id, so focusKeep.ts gives the focus back to the same control after each redraw. No rule here.
 */

const e = escape;

/** "Attacks you can make (3)": one 44 px row per hex that can be attacked, the way in when a finger cannot hit a small hex on the map. */
function listHtml(s: Session, targets: readonly string[]): string {
  const rows = targets.map((t) => {
    const p = attackPreview(s.ctx, s.state, t, defaultAttackers(s.ctx, s.state, t));
    const { defence, yours } = rowLines(p);
    return `<li><button type="button" class="attack-row" data-target="${e(t)}" aria-pressed="${s.attack?.target === t}"><span class="row-name">${e(p.targetName)}</span><span class="row-defence">${e(defence)}</span><span class="row-yours">${e(yours)}</span></button></li>`;
  });
  return `<div class="attacklist"><h2 id="attacks-title">Attacks you can make (${targets.length})</h2>
      <p class="note">Tap a red dashed hex on the map, or its row here. Each hex can be attacked once a turn.</p>
      <ul class="attack-rows" aria-labelledby="attacks-title">${rows.join("")}</ul></div>`;
}

function chipHtml(c: AttackerChip): string {
  const mark = c.state === "chosen" ? "Chosen" : c.state === "free" ? "Not chosen" : "Cannot attack";
  const nth = c.nth ? ` (${e(c.nth)})` : "";
  const grey = c.state === "greyed";
  return `<li><button type="button" class="chip${grey ? " greyed" : ""}" data-unit="${e(c.id)}" aria-pressed="${c.state === "chosen"}"${grey ? ' aria-disabled="true"' : ""}><span class="chip-mark" aria-hidden="true">${mark}</span><span class="chip-name">${e(c.name)}${nth}</span><small>from ${e(c.from)}${grey ? `, ${e(c.reason ?? "")}` : ""}</small></button></li>`;
}

/** "Exchange: you lose all ..." with the words before the first colon in bold. */
function headed(text: string): string {
  const [head, ...rest] = text.split(": ");
  return rest.length > 0 ? `<strong>${e(head!)}:</strong> ${e(rest.join(": "))}` : e(text);
}

function rowHtml(r: ResultRow): string {
  const counter = r.counter?.lines.length
    ? `<details><summary>What the counterattack can lead to</summary><ul>${r.counter.lines.map((l) => `<li><strong>${e(l.rollText)}</strong> ${e(l.text)}</li>`).join("")}</ul></details>`
    : "";
  return `<li><strong class="res-roll">${e(r.rollText)}</strong><span class="res-text">${headed(r.text)}${counter}</span></li>`;
}

/** The numbers and the six results, or the sentence for a hex with no ground defender. */
function outcomeHtml(p: AttackPreview): string {
  if (p.sweep) return `<p class="sweep">${e(p.sweep.text)}</p>`;
  if (!p.numbers) return "";
  const warnings = p.riverWarnings.map((w) => `<p class="warn">${e(w)}</p>`).join("");
  const rows = p.results.length > 0 ? `<h3>If you roll</h3><ol class="results">${p.results.map(rowHtml).join("")}</ol>` : "";
  return `<p class="odds"><strong>Odds:</strong> ${e(p.numbers.oddsText)}</p>${warnings}${rows}`;
}

/** The attack card: the defenders and why they count as they do, the chips, the odds, the results and the one button. */
function cardHtml(s: Session, p: AttackPreview): string {
  const beat = toBeatLine(p);
  const others = nonDefendersLine(p);
  const problems = p.button.disabled && p.problems.length > 1 ? `<ul class="problems">${p.problems.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : "";
  return `<section class="attackcard" aria-labelledby="attack-title">
      <div class="card-head"><h2 id="attack-title" tabindex="-1">Attack on ${e(p.targetName)}</h2><button type="button" id="attack-cancel">Cancel</button></div>
      <h3>Defending</h3>
      <p class="def">${e(defendersLine(p))}</p>
      ${beat ? `<p class="why">${e(beat)}</p>` : ""}${others ? `<p class="muted">${e(others)}</p>` : ""}
      <h3 id="attack-with">Attacking with <small>(tap a unit to add or remove it)</small></h3>
      <ul class="chips attack-chips" aria-labelledby="attack-with">${p.attackers.map(chipHtml).join("")}</ul>
      ${outcomeHtml(p)}
      ${problems}
      <div class="attack-foot">${p.oneTry && !p.button.disabled ? `<p class="muted">${e(p.oneTry)}</p>` : ""}<button type="button" id="attack-go" class="attack-go${p.button.risky ? " risky" : ""}"${p.button.disabled ? " disabled" : ""}>${e(p.button.text)}</button></div>
    </section>`;
}

/** The preview of the open draft, or null. */
export function draftPreview(s: Session): AttackPreview | null {
  return s.attack ? attackPreview(s.ctx, s.state, s.attack.target, s.attack.units) : null;
}

/**
 * Step 7h as one stack of cards, the next thing to do first (spec 07, State 3 and 4): the choices the engine asks for (losses of an Exchange, the
 * advance), the result of the last battle, the list of hexes to attack, and the attack card under the list. Empty unless the player may attack now
 * or a battle result is still shown.
 */
export function attackHtml(s: Session, actions: readonly Action[]): string {
  // While the computer chooses the losses of an Exchange the player's result card stays, with no list under the step buttons.
  if (!attacking(s)) return atStep7h(s) && s.battle ? `<section class="attacks">${resultCardHtml(s)}</section>` : "";
  const targets = attackTargets(actions);
  const p = draftPreview(s);
  const result = !p && s.battle ? resultCardHtml(s) : "";
  const choice = choiceHtml(s, actions);
  const card = p ? cardHtml(s, p) : "";
  if (targets.length === 0 && !card && !result && !choice) return "";
  return `<section class="attacks">${choice}${result}${targets.length > 0 ? listHtml(s, targets) : ""}${card}</section>`;
}

/** Whether the card is open on this hex (the hex card is then hidden: the attack card already lists the defenders). */
export const cardOpenOn = (s: Session, hex: string): boolean => s.attack?.target === hex;
