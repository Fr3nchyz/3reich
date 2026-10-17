import { combatOf } from "../engine/combat-record";
import { roundWords, plural } from "./attackText";
import { escape } from "./mapGeometry";
import { placeName, stackSummary } from "./names";
import type { Session } from "./session";

/**
 * The result card (spec 07, State 3): what the last battle of the player's own attack did, from the events the session logged
 * (resultModel.ts), and what is left to choose. The choices themselves (losses of an Exchange, the advance) are the cards of choiceView.ts,
 * drawn above this one, so the next thing to do is always first.
 */

const e = escape;

export function resultCardHtml(s: Session): string {
  const b = s.battle;
  if (!b) return "";
  const place = placeName(s.ctx.map, b.target);
  const rec = combatOf(s.state);
  const lines: string[] = [];
  if (b.sweep) lines.push(`No roll. ${b.swept.length > 0 ? `Destroyed: ${stackSummary(b.swept, true)}.` : b.displaced.length > 0 ? "" : "Nothing was left to destroy."}`);
  else {
    lines.push(`Column ${b.rounds[0]?.column ?? "none"}: ${b.attackFactors} against ${b.defenseFactors * b.multiplier}.`);
    for (const r of b.rounds) lines.push(roundWords(r));
  }
  const waiting = rec.pending?.target === b.target;
  if (waiting && rec.pending) lines.push(rec.pending.chooser === s.humanSide ? `The Exchange takes at least ${plural(rec.pending.required, "factor")} of yours: you choose which units go.` : "The computer is choosing its losses.");
  const lost = b.lostAttackers.length > 0 ? `You lost: ${stackSummary(b.lostAttackers, true)}.` : waiting ? "" : "You lost nothing.";
  const took = b.lostDefenders.length > 0 ? `They lost: ${stackSummary(b.lostDefenders, true)}.` : waiting ? "" : "They lost nothing.";
  const swept = !b.sweep && b.swept.length > 0 ? `Also destroyed with no roll: ${stackSummary(b.swept, true)}.` : "";
  const driven = b.displaced.map((d) => `${stackSummary([d.unit], true)} ${d.to === null ? "was lost: no friendly port had room" : `moved to ${placeName(s.ctx.map, d.to)}`}`);
  const moved = driven.length > 0 ? `Fleets driven out: ${driven.join("; ")}.` : "";
  const offered = rec.advances.some((a) => a.to === b.target);
  const stayed = s.choice?.stayed.includes(b.target) === true;
  const advance = b.advanced.length > 0 ? `${place} is empty. You advanced ${stackSummary(b.advanced, true)} into it.` : offered ? `${place} is empty.${stayed ? " Your units stayed where they are." : " Your surviving units can advance into it."}` : "";
  const text = [...lines, lost, took, swept, moved, advance].filter(Boolean);
  return `<section class="resultcard" aria-labelledby="result-title">
      <div class="card-head"><h2 id="result-title" tabindex="-1">Result: ${e(place)}</h2><button type="button" id="result-close" aria-label="Close the result">Close</button></div>
      ${text.map((t) => `<p>${e(t)}</p>`).join("")}
      <p class="muted">The battle is also written in the log.</p>
    </section>`;
}
