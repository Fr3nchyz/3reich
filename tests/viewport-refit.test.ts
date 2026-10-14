import { describe, expect, it } from "vitest";
import { panBox, refitBox, wholeOnScreen, zoomBox } from "../src/ui/viewport";

/** The map's box when its screen area changes shape: a window dragged across the breakpoint, browser zoom, a tablet turned over. */

const whole = { x: 0, y: 0, w: 1300, h: 1000 };
const centre = (b: { x: number; y: number; w: number; h: number }) => [b.x + b.w / 2, b.y + b.h / 2];

describe("wholeOnScreen", () => {
  it("is the whole map grown on one axis to the screen's shape, about its centre", () => {
    const wide = wholeOnScreen(whole, { w: 2900, h: 1000 });
    expect(wide.w / wide.h).toBeCloseTo(2.9);
    expect(wide.h).toBeCloseTo(1000);
    expect(centre(wide)).toEqual([650, 500]);
    const tall = wholeOnScreen(whole, { w: 650, h: 1000 });
    expect(tall.w).toBeCloseTo(1300);
    expect(tall.h).toBeCloseTo(2000);
  });
});

describe("refitBox", () => {
  const big = { w: 1300, h: 1000 }, wide = { w: 1450, h: 500 }, small = { w: 650, h: 500 };

  it("takes the new screen's shape, so nothing is cropped or letterboxed", () => {
    const b = refitBox({ ...whole }, whole, big, wide);
    expect(b.w / b.h).toBeCloseTo(wide.w / wide.h);
  });

  it("keeps the map point at the centre", () => {
    const zoomed = { x: 300, y: 200, w: 400, h: 400 * (1000 / 1300) };
    expect(centre(refitBox(zoomed, whole, big, small))).toEqual(centre(zoomed));
  });

  it("keeps the same share of the whole map in view: the whole map stays the whole map", () => {
    const b = refitBox({ ...whole }, whole, big, wide);
    expect(b).toEqual(wholeOnScreen(whole, wide));
    const zoomedIn = { x: 500, y: 400, w: 130, h: 100 };
    const z = refitBox(zoomedIn, whole, big, small);
    // 10x in on both screens: the box is a tenth of the whole-map box for that screen.
    expect(z.w).toBeCloseTo(wholeOnScreen(whole, small).w / 10);
  });

  it("is undone by going back to the old size", () => {
    const zoomed = { x: 300, y: 200, w: 400, h: 400 * (1000 / 1300) };
    const back = refitBox(refitBox(zoomed, whole, big, wide), whole, wide, big);
    for (const k of ["x", "y", "w", "h"] as const) expect(back[k]).toBeCloseTo(zoomed[k]);
  });

  it("reads a letterboxed box by the scale it is drawn at", () => {
    // The whole map in a screen wider than it: drawn at the height-limited scale, as the browser does.
    const letterboxed = refitBox({ ...whole }, whole, wide, wide);
    expect(letterboxed).toEqual(wholeOnScreen(whole, wide));
  });

  it("leaves pan and zoom exact afterwards: a drag of 100 px moves the map 100 px", () => {
    const b = refitBox({ ...whole }, whole, big, small);
    const scale = small.w / b.w;
    const moved = panBox(b, 100, 0, small.w, small.h);
    expect((b.x - moved.x) * scale).toBeCloseTo(100);
    const zoomed = zoomBox(b, wholeOnScreen(whole, small), 300, 300, 0.5);
    // The map point under the pointer does not move.
    expect(zoomed.x + (300 - b.x) / b.w * zoomed.w - 300).toBeCloseTo(0);
  });
});
