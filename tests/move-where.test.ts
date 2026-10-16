import { describe, expect, it } from "vitest";
import { legalActions } from "../src/engine/actions";
import { goTo, chooseStack, selectionNow, setWhereOpen, tapToMove } from "../src/ui/moveTap";
import { moveHtml, WHERE_LIMIT } from "../src/ui/moveView";
import { inf } from "./helpers-move";
import { withUnits } from "./helpers-move-session";

// Spec 10, ticket 10-7: the refused-tap sentence and the fold-out "Where they can go (N)" (the keyboard's way to choose a destination).
const html = (s: ReturnType<typeof withUnits>) => moveHtml(s, legalActions(s.ctx, s.state));

describe("the fold-out of destinations", () => {
  it("lists the yellow hexes as buttons with a place name and a distance, nearest first, shut by default", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 2)]);
    chooseStack(s, "L32");
    const h = html(s);
    expect(h).toContain('id="move-where"');
    expect(h).not.toMatch(/<details[^>]*\sopen/);
    const sel = selectionNow(s)!;
    expect(h).toContain(`Where they can go (${sel.destinations.length})`);
    const dests = [...h.matchAll(/data-dest="([^"]+)"/g)].map((m) => m[1]!);
    expect(dests.length).toBe(Math.min(sel.destinations.length, WHERE_LIMIT));
    const dist = (hex: string) => sel.destinations.find((d) => d.to === hex)!.path.length;
    for (let i = 1; i < dests.length; i++) expect(dist(dests[i]!)).toBeGreaterThanOrEqual(dist(dests[i - 1]!));
    expect(h).toMatch(/1 hex|2 hexes/);
  });

  it("keeps its open state through a redraw", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 2)]);
    chooseStack(s, "L32");
    setWhereOpen(s, true);
    expect(html(s)).toMatch(/<details[^>]*id="move-where"[^>]*\sopen|<details[^>]*\sopen[^>]*id="move-where"/);
    setWhereOpen(s, false);
    expect(html(s)).not.toMatch(/<details[^>]*\sopen/);
  });

  it("a row moves the ticked units exactly as a tap on that yellow hex does", () => {
    const a = withUnits([inf("u1", "germany", "L32", 3, 2)]);
    const b = withUnits([inf("u1", "germany", "L32", 3, 2)]);
    chooseStack(a, "L32");
    chooseStack(b, "L32");
    goTo(a, "L33");
    tapToMove(b, b.ctx.map.hexes.L33!);
    expect(a.state.units.u1!.at).toBe("L33");
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.log).toEqual(b.log);
  });

  it("is not drawn when nothing is ticked, and carries no unit id", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 2)]);
    chooseStack(s, "L32");
    expect(html(s).replace(/data-[a-z]+="[^"]*"|id="[^"]*"/g, "")).not.toMatch(/\bu\d+\b/);
    tapToMove(s, s.ctx.map.hexes.L32!); // a second tap on the chosen hex lets it go
    expect(html(s)).not.toContain("move-where");
  });
});

describe("a refused tap says why", () => {
  it("water, enemy and distance, in words", () => {
    const s = withUnits([inf("u1", "germany", "M32", 3, 2), inf("p1", "poland", "M33", 2, 3)]);
    chooseStack(s, "M32");
    tapToMove(s, s.ctx.map.hexes.M33!);
    expect(s.toast).toBe("Poznan (M33) holds an enemy unit: that is an attack, not a move.");
    tapToMove(s, s.ctx.map.hexes.M28!);
    expect(s.toast).toMatch(/too far for them/);
  });
});

describe("onto one of your own stacks that has not moved yet", () => {
  const two = () => withUnits([inf("u1", "germany", "L32", 3, 3), inf("u3", "germany", "L33", 3, 3)]);

  it("a tap on that hex chooses it instead (the tap behaviour), but the list row moves the unit there", () => {
    const tapped = two();
    chooseStack(tapped, "L32");
    expect(selectionNow(tapped)!.destinations.some((d) => d.to === "L33"), "L33 is a yellow hex for u1").toBe(true);
    tapToMove(tapped, tapped.ctx.map.hexes.L33!);
    expect(tapped.moveChosen?.hex, "the tap re-chose the stack standing there").toBe("L33");
    expect(tapped.state.units.u1!.at).toBe("L32");

    const s = two();
    chooseStack(s, "L32");
    expect(html(s)).toMatch(/data-dest="L33"/);
    goTo(s, "L33");
    expect(s.toast).not.toMatch(/cannot|too far|holds/);
    expect(s.state.units.u1!.at, "u1 joined the stack").toBe("L33");
    expect(s.state.units.u3!.at).toBe("L33");
    expect(legalActions(s.ctx, s.state).some((a) => a.type === "MOVE" && a.units.includes("u3")), "the stack that was there has not moved and still can").toBe(true);
  });
});
