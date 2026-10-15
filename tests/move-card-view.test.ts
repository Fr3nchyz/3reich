import { describe, expect, it } from "vitest";
import { legalActions } from "../src/engine/actions";
import { leadsStatus, nextText } from "../src/ui/nextBar";
import { chooseStack, movableStacks, tickNone, toggleTick } from "../src/ui/moveTap";
import { moveAnnouncement } from "../src/ui/moveView";
import type { Session } from "../src/ui/session";
import { normaliseMode, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import type { WatchInfo } from "../src/ui/watchController";
import { realPositions } from "./helpers-positions";
import { at6f, inf } from "./helpers-move";
import { crafted, sessionAt, withUnits } from "./helpers-move-session";

// Spec 10, ticket 10-4: the Move card, the list of stacks and the bar at step 6f as HTML (wording, plurals, no ids, order, who sees it).
const hexOf = (s: Session, id: string) => s.ctx.map.hexes[id]!;
const html = (s: Session) => statusHtml(s, null, legalActions(s.ctx, s.state));
/** What a person sees or hears: the text and the accessible names, never the data-* keys. */
const words = (h: string): string => [...h.replace(/<[^>]+>/g, "\n").split("\n"), ...[...h.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!)].join("\n");

describe("the list of stacks (nothing chosen)", () => {
  it("shows the reworded prompt, the count and one row per hex with the right plural", () => {
    const h = html(crafted());
    expect(h).toContain("Ground movement (step 6f): tap a stack of yours, tick the units to move, then tap a yellow hex.");
    expect(h).toContain("Stacks that can move (2)");
    expect(h).toMatch(/data-stack="L32"[^>]*><span class="row-name">L32<\/span><span class="row-count">2 units can move<\/span>/);
    expect(h).toMatch(/data-stack="L33"[^>]*><span class="row-name">L33<\/span><span class="row-count">1 unit can move<\/span>/);
    expect(h).not.toContain('class="movecard"');
  });

  it("the bar leads the column with the sentence and the Done button; the card and the list come after it", () => {
    const s = crafted();
    const h = html(s);
    expect(leadsStatus(s)).toBe(true);
    expect(nextText(s, legalActions(s.ctx, s.state))).toBe("Next: tap a stack of yours to move, or finish step 6f.");
    expect(h.indexOf("nextbar")).toBeGreaterThan(-1);
    expect(h.indexOf("nextbar")).toBeLessThan(h.indexOf("movelist"));
    expect(h.slice(h.indexOf("nextbar"), h.indexOf("movelist"))).toContain("Done with step 6f");
    expect(h.match(/<button data-action="\d+">Done with step 6f<\/button>/g)).toHaveLength(1);
  });

  it("with no stack that can move the bar says so and there is no list", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 4)]);
    s.state = at6f([]);
    const h = html(s);
    expect(h).toContain("Next: no unit can move now. Finish step 6f.");
    expect(h).not.toContain("movelist");
    expect(movableStacks(s)).toEqual([]);
  });
});

describe("the Move card", () => {
  it("lists a line per counter, ticked ones pressed, with the tools and the live line", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    const h = html(s);
    expect(h).toContain('<h2 id="move-title" tabindex="-1">Move from L32</h2>');
    expect(h.match(/class="chip mline"/g)).toHaveLength(2);
    expect(h.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(h).toContain('id="move-cancel"');
    expect(h).toContain('id="move-all"');
    expect(h).toContain('id="move-none"');
    expect(h).toContain("2 of 2 ticked.");
    expect(h).toContain("Together they can go up to 1 hex (set by the 2-1 German infantry).");
    expect(h).toContain("Tap a yellow hex to move them there.");
    expect(h).not.toContain("Stacks that can move");
    expect(nextText(s, legalActions(s.ctx, s.state))).toBe("Next: tap a yellow hex to move the units, or cancel.");
    expect(moveAnnouncement(s)).toBe("L32. 2 of 2 ticked. They can go up to 1 hex.");
  });

  it("an unticked line says it stays; nothing ticked says to tick; one unit says it, not them", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u2");
    let h = html(s);
    expect(h.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(h).toContain("<small>stays here</small>");
    expect(h).toContain("1 of 2 ticked.");
    expect(h).toContain("Tap a yellow hex to move it there.");
    expect(h).toContain("Staying in L32: 2-1 German infantry.");
    tickNone(s);
    h = html(s);
    expect(h).toContain("Tick at least one unit.");
    expect(nextText(s, legalActions(s.ctx, s.state))).toBe("Next: tick at least one unit, or cancel.");
  });

  it("counters that cannot move are greyed with the reason, in their own layer, below the ground ones", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 4), inf("a1", "germany", "L32", 2, 6, "air")]);
    tapHex(s, hexOf(s, "L32"));
    const h = html(s);
    expect(h).toContain("<h3>Ground</h3>");
    expect(h).toContain("<h3>Air</h3>");
    expect(h.indexOf("<h3>Ground</h3>")).toBeLessThan(h.indexOf("<h3>Air</h3>"));
    expect(h).toMatch(/class="chip mline greyed" data-unit="a1" aria-disabled="true"/);
    expect(h).toContain("<small>does not move on the ground</small>");
    expect(h).toContain("1 of 1 ticked.");
  });

  it("the lines use the counter's printed numbers and kind, and a held counter says who holds it", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    expect(html(s)).toContain('<span class="hexcard-factors">3-4</span> German infantry');
  });

  it("a faster unit's extra reach is told in a sentence as well as in the second shade", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    expect(html(s)).toContain("The 3-4 German infantry alone could go up to 4 hexes. Untick the 2-1 German infantry to let it go further.");
  });
});

describe("who sees it", () => {
  it("not the computer's turn, not a watched game, not another step", () => {
    const comp = crafted();
    tapHex(comp, hexOf(comp, "L32"));
    comp.humanSide = "allies";
    normaliseMode(comp);
    for (const h of [html(comp), statusHtml(comp, null, [])]) expect(h).not.toMatch(/movecard|movelist|nextbar/);
    const watched = crafted();
    watched.watch = {} as WatchInfo;
    expect(html(watched)).not.toMatch(/movecard|movelist|Stacks that can move/);
    const other = crafted();
    other.state = { ...other.state, position: { part: "player-turn", turn: 1, step: "8b" } };
    expect(html(other)).not.toMatch(/movecard|movelist/);
  });
});

describe("real positions from computer games: wording", () => {
  it("for every stack of every position: no unit id anywhere a person can see or hear, no broken plural, a card whose lines match the hex", () => {
    let cards = 0;
    for (const p of realPositions([1], 2, 3)) {
      const s = sessionAt(p);
      const ids = Object.keys(p.state.units);
      const idPattern = new RegExp(`\\b(${ids.map((i) => i.replace(/[^\w]/g, "")).join("|")})\\b`);
      for (const k of movableStacks(s)) {
        expect(chooseStack(s, k.hex), p.label).toBe(true);
        for (const variant of [0, 1]) {
          if (variant === 1) tickNone(s);
          const h = html(s);
          const seen = words(h);
          expect(seen, `${p.label} ${k.hex}`).not.toMatch(/\bu\d+\b/);
          expect(seen, `${p.label} ${k.hex}`).not.toMatch(idPattern);
          expect(seen).not.toMatch(/undefined|null|\[object|NaN/);
          expect(seen).not.toMatch(/\b1 (units|hexes)\b|\b[02-9] (unit|hex)\b|\b1 of [2-9]\d* ticked\.\s*They\b/);
          expect(h.match(/class="chip mline/g)?.length ?? 0).toBe(Object.values(p.state.units).filter((u) => u.at === k.hex).length);
          cards++;
        }
      }
      const list = words(html(sessionAt(p)));
      expect(list).not.toMatch(idPattern);
      expect(list).not.toMatch(/\b1 units\b/);
    }
    expect(cards).toBeGreaterThan(20);
  });
});
