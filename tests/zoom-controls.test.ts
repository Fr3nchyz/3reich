import { describe, expect, it, vi } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { MapHex } from "../src/engine/map";
import { otherSide } from "../src/engine/game";
import type { GameState } from "../src/engine/types";
import type { MapView } from "../src/ui/mapView";
import { tapHex } from "../src/ui/sessionActions";
import { createSession, type Session } from "../src/ui/session";
import type { WatchInfo } from "../src/ui/watchController";
import { NOTE_MS, NOTHING_SELECTED, NOTHING_SELECTED_COMPUTER, NOTHING_SELECTED_SETUP, NOTHING_SELECTED_STEP3, NOTHING_SELECTED_WATCHING, ZOOM_BUTTONS, bindZoom, canChooseStack, lookedHex, nothingSelectedText, zoomSaid, zoomToSelection, type Looked } from "../src/ui/zoomControls";
import { started } from "./helpers";
import { BUTTON_ZOOM_STEP, MAX_ZOOM_IN, MAX_ZOOM_OUT, clampBox, createViewport, panBox, wholeOnScreen, zoomBox, zoomLevel, type Size } from "../src/ui/viewport";

/** The zoom buttons (spec 08): the maths behind them, the limits, and what a press does and says. */

const whole = { x: 0, y: 0, w: 1300, h: 1000 };
const screen: Size = { w: 1300, h: 1000 };

describe("zoomLevel", () => {
  it("is 1 for the whole map just fitting, in any screen shape", () => {
    expect(zoomLevel(wholeOnScreen(whole, screen), whole, screen)).toBeCloseTo(1);
    const wide: Size = { w: 2900, h: 1000 };
    expect(zoomLevel(wholeOnScreen(whole, wide), whole, wide)).toBeCloseTo(1);
    const tall: Size = { w: 650, h: 1000 };
    expect(zoomLevel(wholeOnScreen(whole, tall), whole, tall)).toBeCloseTo(1);
  });

  it("reads a box that does not have the screen's shape by the scale it is drawn at (the smaller one), not the larger", () => {
    // A box half as wide as the screen's shape but as tall: drawn at the height-limited scale, so it is the whole map, not twice in.
    expect(zoomLevel({ x: 0, y: 0, w: 650, h: 1000 }, whole, screen)).toBeCloseTo(1);
    expect(zoomLevel({ x: 0, y: 0, w: 1300, h: 500 }, whole, screen)).toBeCloseTo(1);
  });

  it("is the limits at the limits: 12 closest, a little under 1 farthest", () => {
    const fit = wholeOnScreen(whole, screen);
    expect(zoomLevel({ ...fit, w: fit.w / MAX_ZOOM_IN, h: fit.h / MAX_ZOOM_IN }, whole, screen)).toBeCloseTo(MAX_ZOOM_IN);
    expect(zoomLevel({ ...fit, w: fit.w * MAX_ZOOM_OUT, h: fit.h * MAX_ZOOM_OUT }, whole, screen)).toBeCloseTo(1 / MAX_ZOOM_OUT);
  });
});

describe("the step of a button", () => {
  const fit = wholeOnScreen(whole, screen);
  it("doubles on zoom in and halves on zoom out, and a press of each is undone by the other", () => {
    expect(BUTTON_ZOOM_STEP).toBe(2);
    const closer = zoomBox(fit, fit, 650, 500, 1 / BUTTON_ZOOM_STEP);
    expect(zoomLevel(closer, whole, screen)).toBeCloseTo(2);
    const back = zoomBox(closer, fit, 650, 500, BUTTON_ZOOM_STEP);
    for (const k of ["x", "y", "w", "h"] as const) expect(back[k]).toBeCloseTo(fit[k]);
  });

  it("stops at the largest zoom however many times it is pressed, and four presses from the whole map are not yet there", () => {
    let b = fit;
    for (let i = 0; i < 3; i++) b = zoomBox(b, fit, 650, 500, 1 / BUTTON_ZOOM_STEP);
    expect(zoomLevel(b, whole, screen)).toBeCloseTo(8);
    for (let i = 0; i < 6; i++) b = zoomBox(b, fit, 650, 500, 1 / BUTTON_ZOOM_STEP);
    expect(zoomLevel(b, whole, screen)).toBeCloseTo(MAX_ZOOM_IN);
  });
});

describe("odd numbers never reach the box", () => {
  const vb = { x: 100, y: 100, w: 650, h: 500 };
  const fit = wholeOnScreen(whole, screen);
  it("zoomBox returns the old box for a NaN, infinite or non-positive input", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(zoomBox(vb, fit, bad, 5, 0.5)).toBe(vb);
      expect(zoomBox(vb, fit, 5, bad, 0.5)).toBe(vb);
      expect(zoomBox(vb, fit, 5, 5, bad)).toBe(vb);
    }
    expect(zoomBox(vb, fit, 5, 5, 0)).toBe(vb);
    expect(zoomBox(vb, fit, 5, 5, -1)).toBe(vb);
    expect(zoomBox(vb, fit, 5, 5, 0.5), "a good input still zooms").not.toBe(vb);
  });

  it("panBox returns the old box for a NaN or infinite drag or a screen with no size", () => {
    expect(panBox(vb, NaN, 0, 650, 500)).toBe(vb);
    expect(panBox(vb, 0, Infinity, 650, 500)).toBe(vb);
    expect(panBox(vb, 10, 10, 0, 500)).toBe(vb);
    expect(panBox(vb, 10, 10, 650, NaN)).toBe(vb);
    expect(panBox(vb, 65, 0, 650, 500).x).toBeCloseTo(vb.x - 65);
  });
});

describe("clampBox", () => {
  it("holds a box inside the limits about its own centre and leaves one inside them alone", () => {
    const tiny = { x: 600, y: 480, w: 20, h: 20 / 1.3 };
    const c = clampBox(tiny, whole, screen);
    expect(zoomLevel(c, whole, screen)).toBeCloseTo(MAX_ZOOM_IN);
    expect(c.x + c.w / 2).toBeCloseTo(610);
    expect(c.y + c.h / 2).toBeCloseTo(480 + 10 / 1.3);
    const ok = { x: 100, y: 100, w: 650, h: 500 };
    expect(clampBox(ok, whole, screen)).toEqual(ok);
  });
});

/** A stand-in for the <svg>, as in viewport-refit.test.ts. */
function fakeSvg(size: Size) {
  const svg = {
    size,
    viewBox: "",
    getBoundingClientRect: () => ({ left: 0, top: 0, right: svg.size.w, bottom: svg.size.h, width: svg.size.w, height: svg.size.h }),
    setAttribute: (_: string, v: string) => { svg.viewBox = v; },
    box: () => { const [x, y, w, h] = svg.viewBox.split(" ").map(Number) as [number, number, number, number]; return { x, y, w, h }; },
  };
  return svg;
}

describe("the viewport behind the buttons", () => {
  it("zooms about the middle of the map and reports the level", () => {
    const svg = fakeSvg(screen);
    const v = createViewport(svg as unknown as SVGSVGElement, whole);
    v.focus([]);
    const before = svg.box();
    v.zoomMiddle(0.5);
    const after = svg.box();
    expect(after.w).toBeCloseTo(before.w / 2);
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2);
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2);
    expect(v.level()).toBeCloseTo(2);
    for (let i = 0; i < 10; i++) v.zoomMiddle(0.5);
    expect(v.level()).toBeCloseTo(MAX_ZOOM_IN);
    for (let i = 0; i < 10; i++) v.zoomMiddle(2);
    expect(v.level()).toBeCloseTo(1 / MAX_ZOOM_OUT);
  });

  it("keeps a fit to one hex inside the largest zoom, and a fit to the whole map at level 1", () => {
    const svg = fakeSvg(screen);
    const v = createViewport(svg as unknown as SVGSVGElement, whole);
    v.focus([[650, 500]]);
    expect(v.level()).toBeLessThanOrEqual(MAX_ZOOM_IN + 1e-9);
    v.focus([]);
    expect(v.level()).toBeCloseTo(1);
  });

  it("has a level of 1 and ignores a press while the map has no size", () => {
    const svg = fakeSvg({ w: 0, h: 0 });
    const v = createViewport(svg as unknown as SVGSVGElement, whole);
    v.zoomMiddle(0.5);
    expect(svg.viewBox).toBe("");
    expect(v.level()).toBe(1);
  });
});

describe("zoomSaid", () => {
  it("tells the level in words and the two ends of the range", () => {
    expect(zoomSaid(1)).toBe("Zoom 1 time");
    expect(zoomSaid(1.04)).toBe("Zoom 1 time");
    expect(zoomSaid(1.5)).toBe("Zoom 1.5 times");
    expect(zoomSaid(0.9)).toBe("Zoomed out a little past the whole map");
    expect(zoomSaid(2)).toBe("Zoom 2 times");
    expect(zoomSaid(3.04)).toBe("Zoom 3 times");
    expect(zoomSaid(MAX_ZOOM_IN)).toBe("Zoomed in as far as it goes");
    expect(zoomSaid(1 / MAX_ZOOM_OUT)).toBe("Zoomed out as far as it goes");
  });
});

describe("the buttons", () => {
  it("are four real buttons, each with a name for a screen reader and a tooltip", () => {
    const buttons = [...ZOOM_BUTTONS.matchAll(/<button type="button" data-zoom="(\w+)" aria-label="([^"]+)" title="([^"]+)">/g)];
    expect(buttons.map((m) => [m[1], m[2]])).toEqual([["in", "Zoom in"], ["out", "Zoom out"], ["whole", "Show the whole map"], ["selected", "Zoom to the selected hex or counter"]]);
    for (const m of buttons) expect(m[3]).toBe(m[2]);
    expect(ZOOM_BUTTONS.match(/<button/g)).toHaveLength(4);
    expect(ZOOM_BUTTONS, "the pictures are hidden from screen readers").not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
  });

  function bound(opts: { outlined: boolean; looked?: Looked | null }) {
    const calls: string[] = [];
    const view = {
      zoomBy: (f: number) => { calls.push(`zoomBy ${f}`); return 4; },
      focus: (ids: Iterable<string>) => calls.push(`focus ${[...ids].length}`),
      focusOutlined: () => { calls.push("focusOutlined"); return opts.outlined; },
    } as unknown as MapView;
    let onClick: (e: unknown) => void = () => undefined;
    const zoom = { addEventListener: (_: string, h: (e: unknown) => void) => { onClick = h; } } as unknown as HTMLElement;
    const zoomSay = { textContent: "" } as HTMLElement;
    const zoomNote = { textContent: "" } as HTMLElement;
    const timers: { run: () => void; ms: number }[] = [];
    bindZoom({ zoom, zoomSay, zoomNote }, view, () => opts.looked ?? null, (run) => run(), (run, ms) => timers.push({ run, ms }));
    const press = (action: string | null) => onClick({ target: { closest: () => (action ? { dataset: { zoom: action } } : null) } });
    return { calls, zoomSay, zoomNote, timers, press };
  }

  it("zoom in halves the box, zoom out doubles it, whole shows the whole map, and each says what it did", () => {
    const { calls, zoomSay, press } = bound({ outlined: true });
    press("in");
    expect(calls.at(-1)).toBe("zoomBy 0.5");
    expect(zoomSay.textContent).toBe("Zoom 4 times");
    press("out");
    expect(calls.at(-1)).toBe("zoomBy 2");
    press("whole");
    expect(calls.at(-1)).toBe("focus 0");
    expect(zoomSay.textContent).toBe("Showing the whole map");
  });

  it("zoom to the selected counter says so, or says that nothing is selected", () => {
    const yes = bound({ outlined: true });
    yes.press("selected");
    expect(yes.zoomSay.textContent).toBe("Zoomed to the selected counter");
    const no = bound({ outlined: false });
    no.press("selected");
    expect(no.zoomSay.textContent).toBe(NOTHING_SELECTED);
  });

  it("with no outlined hex the target button zooms to the hex on the hex card and says which", () => {
    const hexCard = bound({ outlined: false, looked: { id: "M35", name: "Warsaw (M35)" } });
    hexCard.press("selected");
    expect(hexCard.calls).toEqual(["focusOutlined", "focus 1"]);
    expect(hexCard.zoomSay.textContent).toBe("Zoomed to the hex Warsaw (M35)");
    expect(hexCard.zoomNote.textContent, "the map needs no extra message when it moves").toBe("");
  });

  it("outlined hexes win over the hex on the hex card", () => {
    const both = bound({ outlined: true, looked: { id: "M35", name: "Warsaw (M35)" } });
    both.press("selected");
    expect(both.calls).toEqual(["focusOutlined"]);
    expect(both.zoomSay.textContent).toBe("Zoomed to the selected counter");
  });

  it("with nothing selected the message is also shown on the map, goes by itself after NOTE_MS, and the view does not move", () => {
    const none = bound({ outlined: false });
    none.press("selected");
    expect(none.calls).toEqual(["focusOutlined"]);
    expect(none.zoomNote.textContent).toBe(NOTHING_SELECTED);
    expect(none.timers.map((t) => t.ms)).toEqual([NOTE_MS]);
    none.timers[0]!.run();
    expect(none.zoomNote.textContent).toBe("");
  });

  it("the words say what is true for the game now: playing, watching, or setting up", () => {
    const at = (phase: string, watch: boolean) => nothingSelectedText({ state: { phase }, watch: watch ? {} : undefined } as unknown as Session);
    expect(at("player-turn", false)).toBe(NOTHING_SELECTED);
    expect(at("player-turn", true)).toBe("Nothing is selected. Tap a hex to look at it, then press this again.");
    expect(at("setup", false)).toBe("Nothing is selected. Pick a counter to place first.");
    expect(at("setup", true), "no hex card during setup, even when watching").toBe(NOTHING_SELECTED_SETUP);
    expect(NOTHING_SELECTED_WATCHING).not.toContain("counters");
    expect(NOTHING_SELECTED, "playing: your counters are what you choose").toContain("counters");
  });

  describe("the words on the computer's turn and at step 3 (where nothing can be chosen)", () => {
    const turn = started(SCENARIO_1939, 1); // the game waits at step 10b of a Player Turn
    const me = turn.activeSide; // the side the player plays
    const session = (state: GameState, watch = false): Session => ({ ...createSession(SCENARIO_1939, me, 1), state, ...(watch ? { watch: {} as WatchInfo } : {}) });
    const at3 = (state: GameState) => ({ ...state, position: { part: "player-turn" as const, turn: 1 as const, step: "3" } });
    const computersTurn = { ...turn, activeSide: otherSide(me) };

    it("the player's own turn at step 10b keeps the playing words", () => {
      expect(nothingSelectedText(session(turn))).toBe(NOTHING_SELECTED);
    });

    it("the computer's turn says it is the computer's turn, and that a tapped hex is looked at", () => {
      expect(nothingSelectedText(session(computersTurn))).toBe("It is the computer's turn. Tap a hex to look at it.");
      expect(NOTHING_SELECTED_COMPUTER).toBe("It is the computer's turn. Tap a hex to look at it.");
    });

    it("step 3 says there is nothing to select at this step, and that a tapped hex is looked at", () => {
      expect(nothingSelectedText(session(at3(turn)))).toBe("Nothing to select at this step. Tap a hex to look at it.");
      expect(NOTHING_SELECTED_STEP3).toBe("Nothing to select at this step. Tap a hex to look at it.");
    });

    it("a tap still opens the hex card on the computer's turn and at step 3, so the words are true", () => {
      for (const state of [computersTurn, at3(turn)]) {
        const s = session(state);
        tapHex(s, { id: "M33" } as MapHex);
        expect(lookedHex(s)?.id).toBe("M33");
      }
    });

    it("the note over the map shows only where a stack can be chosen: step 6f of the player's own turn (and setup), not on the computer's turn, at step 3, at other steps or when watching", () => {
      const at6f = { ...turn, position: { part: "player-turn" as const, turn: 1 as const, step: "6f" } };
      expect(canChooseStack(session(at6f))).toBe(true);
      expect(canChooseStack(session({ ...computersTurn, position: at6f.position }))).toBe(false);
      expect(canChooseStack(session(at3(turn)))).toBe(false);
      expect(canChooseStack(session(turn)), "step 10b").toBe(false);
      expect(canChooseStack(session(at6f, true))).toBe(false);
      expect(canChooseStack(session({ ...turn, phase: "setup", position: null }))).toBe(true);
    });

    it("pressing the target button with nothing to choose still says the words, but puts no note on the map and sets no timer", () => {
      const view = { focusOutlined: () => false, focus: () => undefined } as unknown as MapView;
      let onClick: (e: unknown) => void = () => undefined;
      const zoomSay = { textContent: "" } as HTMLElement;
      const zoomNote = { textContent: "" } as HTMLElement;
      const timers: number[] = [];
      let choosable = false;
      bindZoom({ zoom: { addEventListener: (_: string, h: (e: unknown) => void) => { onClick = h; } } as unknown as HTMLElement, zoomSay, zoomNote }, view, () => null, (run) => run(), (_, ms) => timers.push(ms), () => NOTHING_SELECTED_COMPUTER, () => choosable);
      const press = () => onClick({ target: { closest: () => ({ dataset: { zoom: "selected" } }) } });
      press();
      expect(zoomSay.textContent).toBe(NOTHING_SELECTED_COMPUTER);
      expect(zoomNote.textContent).toBe("");
      expect(timers).toEqual([]);
      choosable = true;
      press();
      expect(zoomNote.textContent).toBe(NOTHING_SELECTED_COMPUTER);
      expect(timers).toEqual([NOTE_MS]);
    });

    it("no computer word shows while setting up or watching", () => {
      expect(nothingSelectedText(session({ ...computersTurn, phase: "setup" }))).toBe(NOTHING_SELECTED_SETUP);
      expect(nothingSelectedText(session(computersTurn, true))).toBe(NOTHING_SELECTED_WATCHING);
    });
  });

  it("the line given for the game now is the one said, shown on the map and read aloud", () => {
    let words = NOTHING_SELECTED_WATCHING;
    const calls: string[] = [];
    const view = { focusOutlined: () => false, focus: () => calls.push("focus") } as unknown as MapView;
    let onClick: (e: unknown) => void = () => undefined;
    const zoomSay = { textContent: "" } as HTMLElement;
    const zoomNote = { textContent: "" } as HTMLElement;
    bindZoom({ zoom: { addEventListener: (_: string, h: (e: unknown) => void) => { onClick = h; } } as unknown as HTMLElement, zoomSay, zoomNote }, view, () => null, (run) => run(), () => undefined, () => words);
    const press = () => onClick({ target: { closest: () => ({ dataset: { zoom: "selected" } }) } });
    press();
    expect(zoomNote.textContent).toBe(NOTHING_SELECTED_WATCHING);
    expect(zoomSay.textContent).toBe(NOTHING_SELECTED_WATCHING);
    words = NOTHING_SELECTED_SETUP;
    press();
    expect(zoomNote.textContent).toBe(NOTHING_SELECTED_SETUP);
    expect(calls, "the map does not move").toEqual([]);
  });

  it("an old timer never clears a newer message, and another press clears a shown one", () => {
    const none = bound({ outlined: false });
    none.press("selected");
    none.press("selected");
    none.timers[0]!.run();
    expect(none.zoomNote.textContent, "the first press's timer is stale").toBe(NOTHING_SELECTED);
    none.timers[1]!.run();
    expect(none.zoomNote.textContent).toBe("");
    none.press("selected");
    none.press("in");
    expect(none.zoomNote.textContent, "a different press takes the message away").toBe("");
  });

  it("clears the shown message on real timers after NOTE_MS (the default timer)", () => {
    vi.useFakeTimers();
    try {
      const view = { focusOutlined: () => false } as unknown as MapView;
      let onClick: (e: unknown) => void = () => undefined;
      const zoomNote = { textContent: "" } as HTMLElement;
      bindZoom({ zoom: { addEventListener: (_: string, h: (e: unknown) => void) => { onClick = h; } } as unknown as HTMLElement, zoomSay: { textContent: "" } as HTMLElement, zoomNote }, view, () => null);
      onClick({ target: { closest: () => ({ dataset: { zoom: "selected" } }) } });
      expect(zoomNote.textContent).toBe(NOTHING_SELECTED);
      vi.advanceTimersByTime(NOTE_MS - 1);
      expect(zoomNote.textContent, "still there just before").toBe(NOTHING_SELECTED);
      vi.advanceTimersByTime(1);
      expect(zoomNote.textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("say the same words again for a second press: the line is cleared first and set a moment later", () => {
    const writes: string[] = [];
    const zoomSay = { set textContent(v: string) { writes.push(v); } } as HTMLElement;
    const view = { zoomBy: () => 12 } as unknown as MapView;
    let onClick: (e: unknown) => void = () => undefined;
    const later: (() => void)[] = [];
    bindZoom({ zoom: { addEventListener: (_: string, h: (e: unknown) => void) => { onClick = h; } } as unknown as HTMLElement, zoomSay, zoomNote: { textContent: "" } as HTMLElement }, view, () => null, (run) => later.push(run));
    const press = () => onClick({ target: { closest: () => ({ dataset: { zoom: "in" } }) } });
    press();
    later.shift()!();
    press();
    expect(writes, "cleared, then said").toEqual(["", "Zoomed in as far as it goes", ""]);
    later.shift()!();
    expect(writes.at(-1)).toBe("Zoomed in as far as it goes");
    press(); press(); // two quick presses: only the last words are set
    later.splice(0).forEach((run) => run());
    expect(writes.filter((w) => w !== "")).toHaveLength(3);
  });

  it("ignore a click that is not on one of the buttons", () => {
    const { calls, press, zoomSay } = bound({ outlined: true });
    press(null);
    expect(calls).toEqual([]);
    expect(zoomSay.textContent).toBe("");
  });
});

describe("what the target button zooms to", () => {
  const stub = (outlined: boolean) => {
    const focused: string[][] = [];
    return { focused, view: { focusOutlined: () => outlined, focus: (ids: Iterable<string>) => focused.push([...ids]) } };
  };
  const warsaw = { id: "M35", name: "Warsaw (M35)" };

  it("is the outlined hexes first, then the hex on the hex card, else nothing", () => {
    const a = stub(true);
    expect(zoomToSelection(a.view, warsaw)).toBe("outlined");
    expect(a.focused, "the outlined hexes were fitted by focusOutlined itself").toEqual([]);
    const b = stub(false);
    expect(zoomToSelection(b.view, warsaw)).toBe("hex");
    expect(b.focused).toEqual([["M35"]]);
    const c = stub(false);
    expect(zoomToSelection(c.view, null)).toBe("none");
    expect(c.focused).toEqual([]);
  });

  it("reads the hex card's hex from the session: none during setup or after the card is closed, else the hex with its name", () => {
    const at = (phase: string, lookedAt: string | null) => ({ state: { phase }, lookedAt, ctx: { map: { hexes: { M35: { name: "Warsaw" } } } } }) as unknown as Session;
    expect(lookedHex(at("setup", "M35"))).toBeNull();
    expect(lookedHex(at("player-turn", null))).toBeNull();
    expect(lookedHex(at("player-turn", "M35"))).toEqual({ id: "M35", name: "Warsaw (M35)" });
  });

  it("a fit to one hex stays inside the zoom limits (the same clamp every fit uses)", () => {
    const svg = fakeSvg(screen);
    const v = createViewport(svg as unknown as SVGSVGElement, whole);
    v.focus([[650, 500]]);
    expect(v.level()).toBeLessThanOrEqual(MAX_ZOOM_IN + 1e-9);
    expect(v.level()).toBeGreaterThan(1);
  });
});
