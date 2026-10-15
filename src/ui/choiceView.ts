import type { Action } from "../engine/actions";
import { advanceModel, type AdvanceModel } from "./advanceOptions";
import { pickedAdvance, pickedLosses, openOffers } from "./choiceTap";
import { lossModel, type LossModel } from "./lossOptions";
import { plural } from "./attackText";
import { escape } from "./mapGeometry";
import type { Session } from "./session";

/**
 * The choice cards of step 7h (spec 07, State 4) as HTML: "Choose your losses" for an Exchange the player settles, and "Advance into <place>?" for
 * the survivors who may move into the hex the battle emptied. Chips are buttons with `aria-pressed` and a stable key (`data-pick`); one confirm button each,
 * and for the advance a "Stay" button. No raw ids anywhere; no rule here (lossOptions.ts and advanceOptions.ts hold the data).
 */

const e = escape;

function chip(id: string, name: string, nth: string | null, mark: boolean, small: string): string {
  return `<li><button type="button" class="chip pick" data-pick="${e(id)}" aria-pressed="${mark}"><span class="chip-mark" aria-hidden="true">${mark ? "Chosen" : "Not chosen"}</span><span class="chip-name">${e(name)}${nth ? ` (${e(nth)})` : ""}</span><small>${e(small)}</small></button></li>`;
}

function lossHtml(m: LossModel): string {
  const ways = m.groups.length > 1
    ? `<h3 id="loss-ways">Ways to do it <small>(tap a way, or choose units yourself)</small></h3>
      <ul class="ways" aria-labelledby="loss-ways">${m.groups.map((g, i) => `<li><button type="button" class="way" data-lossway="${i}">Lose ${e(g.text)} <small>(${e(plural(g.factors, "factor"))}${g.variants > 1 ? `, you pick which of ${g.variants} sets` : ""})</small></button></li>`).join("")}</ul>${m.moreGroups ? `<p class="muted">More ways exist: choose units yourself.</p>` : ""}`
    : "";
  return `<section class="choicecard losscard" aria-labelledby="choice-title-0">
      <div class="card-head"><h2 id="choice-title-0" tabindex="-1">Choose your losses</h2></div>
      <p>The Exchange at ${e(m.targetName)}: at least ${e(plural(m.required, "factor"))} of your units must be lost, and no more units than needed.</p>
      ${ways}
      <h3 id="loss-units">Your units</h3>
      <ul class="chips attack-chips" aria-labelledby="loss-units">${m.chips.map((c) => chip(c.id, c.name, c.nth, c.chosen, `from ${c.from}${c.countsAs ? `, ${c.countsAs}` : ""}`)).join("")}</ul>
      <p class="total" role="status">${e(m.total)}</p>
      <div class="choice-foot"><button type="button" id="loss-go" class="choice-go"${m.button.disabled ? " disabled" : ""}>${e(m.button.text)}</button></div>
    </section>`;
}

function advanceHtml(m: AdvanceModel, i: number): string {
  return `<section class="choicecard advancecard" aria-labelledby="choice-title-${i}" data-to="${e(m.to)}">
      <div class="card-head"><h2 id="choice-title-${i}" tabindex="-1">Advance into ${e(m.toName)}?</h2></div>
      <p>${e(m.toName)} is empty. These surviving units may move in; the others stay where they are.</p>
      <ul class="chips attack-chips" aria-label="Units that may advance into ${e(m.toName)}">${m.chips.map((c) => chip(c.id, c.name, c.nth, c.chosen, `from ${c.from}`)).join("")}</ul>
      <div class="choice-foot">
        <button type="button" class="choice-go" data-advancego="${e(m.to)}"${m.button.disabled ? " disabled" : ""}>${e(m.button.text)}</button>
        <button type="button" class="choice-stay" data-advancestay="${e(m.to)}">Stay</button>
      </div>
    </section>`;
}

/** The losses card, or else the advance cards, for the player's own choices; empty when the engine asks for nothing (or the computer chooses). */
export function choiceHtml(s: Session, actions: readonly Action[]): string {
  const loss = lossModel(s.ctx, s.state, s.humanSide, actions, pickedLosses(s));
  if (loss) return lossHtml(loss);
  return openOffers(s, actions).flatMap((to, i) => {
    const m = advanceModel(s.ctx, s.state, actions, to, pickedAdvance(s, to, actions));
    return m ? [advanceHtml(m, i)] : [];
  }).join("");
}
