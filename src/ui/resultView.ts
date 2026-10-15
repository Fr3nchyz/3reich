import { combatOf } from "../engine/combat-record";
import { roundWords, plural } from "./attackText";
import { escape } from "./mapGeometry";
import { placeName, stackSummary } from "./names";
import type { Session } from "./session";

/**
 * The result card (spec 07, State 3): what the last battle of the player's own attack did, from the events the session logged
 * (resultModel.ts), and what is left to choose. The choices themselves (losses of an Exchange, the advance) stay the engine's buttons
 * with names (actionLabels.ts); chip cards for them are ticket 07-7.
 */

const e = escape;

export function resultCardHtml(s: Session): string {
  const b = s.battle;
  if (!b) return "";
  const place = placeName(s.ctx.map, b.target);
  const rec = combatOf(s.state);
  const lines: string[] = [];
  if (b.sweep) lines.push(`No roll. ${b.swept.length > 0 ? `Destroyed: ${stackSummary(b.swept, true)}.` : "Nothing was left to destroy."}`);
  else {
    lines.push(`Column ${b.rounds[0]?.column ?? "none"}: ${b.attackFactors} against ${b.defenseFactors * b.multiplier}.`);
    for (const r of b.rounds) lines.push(roundWords(r));
  }
  const waiting = rec.pending?.target === b.target;
  if (waiting && rec.pending) lines.push(rec.pending.chooser === s.humanSide ? `Choose your losses: at least ${plural(rec.pending.required, "factor")} must go. Each button above is one way to do it.` : "The computer is choosing its losses.");
  const lost = b.lostAttackers.length > 0 ? `You lost: ${stackSummary(b.lostAttackers, true)}.` : waiting ? "" : "You lost nothing.";
  const took = b.lostDefenders.length > 0 ? `They lost: ${stackSummary(b.lostDefenders, true)}.` : waiting ? "" : "They lost nothing.";
  const swept = !b.sweep && b.swept.length > 0 ? `Also destroyed with no roll: ${stackSummary(b.swept, true)}.` : "";
  const advance = rec.advances.some((a) => a.to === b.target) ? `${place} is empty. Your surviving units can advance into it: use the Advance buttons above, or leave them where they are.` : "";
  const text = [...lines, lost, took, swept, advance].filter(Boolean);
  return `<section class="resultcard" aria-labelledby="result-title">
      <div class="card-head"><h2 id="result-title" tabindex="-1">Result: ${e(place)}</h2><button type="button" id="result-close" aria-label="Close the result">Close</button></div>
      ${text.map((t) => `<p>${e(t)}</p>`).join("")}
      <p class="muted">The battle is also written in the log below.</p>
    </section>`;
}
