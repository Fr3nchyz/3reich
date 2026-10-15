import { describe, expect, it } from "vitest";
import type { MapView } from "../src/ui/mapView";
import { NOTHING_SELECTED, ZOOM_BUTTONS, bindZoom, zoomSaid } from "../src/ui/zoomControls";
import { BUTTON_ZOOM_STEP, MAX_ZOOM_IN, MAX_ZOOM_OUT, clampBox, createViewport, wholeOnScreen, zoomBox, zoomLevel, type Size } from "../src/ui/viewport";

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
    expect(zoomSaid(1)).toBe("Zoom 1 times");
    expect(zoomSaid(2)).toBe("Zoom 2 times");
    expect(zoomSaid(3.04)).toBe("Zoom 3 times");
    expect(zoomSaid(MAX_ZOOM_IN)).toBe("Zoomed in as far as it goes");
    expect(zoomSaid(1 / MAX_ZOOM_OUT)).toBe("Zoomed out as far as it goes");
  });
});

describe("the buttons", () => {
  it("are four real buttons, each with a name for a screen reader and a tooltip", () => {
    const buttons = [...ZOOM_BUTTONS.matchAll(/<button type="button" data-zoom="(\w+)" aria-label="([^"]+)" title="([^"]+)">/g)];
    expect(buttons.map((m) => [m[1], m[2]])).toEqual([["in", "Zoom in"], ["out", "Zoom out"], ["whole", "Show the whole map"], ["selected", "Zoom to the selected counter"]]);
    for (const m of buttons) expect(m[3]).toBe(m[2]);
    expect(ZOOM_BUTTONS.match(/<button/g)).toHaveLength(4);
    expect(ZOOM_BUTTONS, "the pictures are hidden from screen readers").not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
  });

  function bound(opts: { outlined: boolean }) {
    const calls: string[] = [];
    const view = {
      zoomBy: (f: number) => { calls.push(`zoomBy ${f}`); return 4; },
      focus: (ids: Iterable<string>) => calls.push(`focus ${[...ids].length}`),
      focusOutlined: () => { calls.push("focusOutlined"); return opts.outlined; },
    } as unknown as MapView;
    let onClick: (e: unknown) => void = () => undefined;
    const zoom = { addEventListener: (_: string, h: (e: unknown) => void) => { onClick = h; } } as unknown as HTMLElement;
    const zoomSay = { textContent: "" } as HTMLElement;
    bindZoom({ zoom, zoomSay }, view);
    const press = (action: string | null) => onClick({ target: { closest: () => (action ? { dataset: { zoom: action } } : null) } });
    return { calls, zoomSay, press };
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

  it("ignore a click that is not on one of the buttons", () => {
    const { calls, press, zoomSay } = bound({ outlined: true });
    press(null);
    expect(calls).toEqual([]);
    expect(zoomSay.textContent).toBe("");
  });
});
