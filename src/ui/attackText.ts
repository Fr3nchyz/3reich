import type { CombatRound } from "../engine/combat";
import type { AttackPreview } from "./attackPreview";

/**
 * The words of the attack list, card and result card (spec 07, Part D: all new text in one module, so a translation is not a hunt). Pure
 * functions from the preview model's plain data to strings; no HTML and no rules here. Board-game words: Exchange, Counterattack, Eliminated.
 */

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Names counted: ["1-3 Polish infantry", "1-3 Polish infantry", "1 Polish air"] -> "2 x 1-3 Polish infantry, 1 Polish air". */
export function grouped(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${n} x ${name}` : name)).join(", ");
}

const total = (xs: readonly { strength: number }[]): number => xs.reduce((n, x) => n + x.strength, 0);

/** "2 x 1-3 Polish infantry = 2 factors": who defends, and what they are worth printed on the counters. */
export function defendersLine(p: AttackPreview): string {
  if (p.defenders.length === 0) return p.sweep ? "No ground unit defends this hex." : "No defenders.";
  return `${grouped(p.defenders.map((d) => d.name))} = ${plural(total(p.defenders), "factor")}`;
}

/** What the defence is measured against: "plain country: doubled, so 4 to beat", or nothing while no unit is chosen. */
export const toBeatLine = (p: AttackPreview): string | null => (p.numbers ? `${p.numbers.multiplierReason}, so ${p.numbers.defenseTotal} to beat` : null);

/** The counters that stand in the hex but do not defend: "2 x 1 Polish air do not defend". */
export function nonDefendersLine(p: AttackPreview): string | null {
  const by = p.nonDefenders.filter((n) => !p.sweep?.destroyed.includes(n.name));
  if (by.length === 0) return null;
  const reasons = [...new Set(by.map((n) => n.reason))];
  return `${grouped(by.map((n) => n.name))} ${reasons.length === 1 ? reasons[0]!.replace(/^is /, "are ").replace(/^does /, "do ") : "do not take part"}.`;
}

/** The second line of a row in "Attacks you can make": who defends and how many factors you can bring. */
export function rowLines(p: AttackPreview): { defence: string; yours: string } {
  const mine = total(p.attackers.filter((c) => c.state !== "greyed"));
  const defence = p.sweep ? `${grouped(p.sweep.destroyed)}: no ground defender, destroyed with no roll` : `${defendersLine(p)}${p.numbers ? `, ${p.numbers.multiplierReason.split(":")[0]} x${p.numbers.multiplier}` : ""}`;
  return { defence, yours: `you can bring ${plural(mine, "factor")}` };
}

/** One sentence for the screen reader after a change: "Odds 1-1: 7 against 4." (spec 07 Part D) */
export function announcement(p: AttackPreview): string {
  if (p.problems.length > 0) return p.button.disabled ? p.button.text : p.problems[0]!;
  if (p.sweep) return `No roll: ${p.button.text}.`;
  const n = p.numbers!;
  return n.column === null ? `Weaker than 1-4: ${n.attackFactors} against ${n.defenseTotal}, no roll.` : `Odds ${n.column}: ${n.attackFactors} against ${n.defenseTotal}.`;
}

/** What one die roll of the battle was, in the board game's words. A counterattack round is rolled by the defenders, so its A and D read the other way round. */
export function roundWords(r: CombatRound): string {
  const column = r.column === null ? "no column" : `column ${r.column}`;
  if (r.result === "auto-eliminated") return "Weaker than 1-4: no roll, your attackers are eliminated.";
  const mine = r.by === "attacker";
  const what: Record<string, string> = {
    A: mine ? "your attackers are eliminated" : "the defenders are eliminated",
    D: mine ? "the defenders are eliminated" : "your attackers are eliminated",
    Ex: "Exchange",
    CA: mine ? "Counterattack" : "your attack is made again",
    CA1: "Counterattack",
    CA2: "Counterattack",
    CA3: "Counterattack",
  };
  return `${mine ? "Your attack" : "Their counterattack"}, ${column}, roll ${r.roll}: ${what[r.result] ?? r.result}.`;
}
