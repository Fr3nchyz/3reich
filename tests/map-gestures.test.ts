import { describe, expect, it } from "vitest";
import { TAP_SLOP_PX, createTapTracker, movedTooFar } from "../src/ui/tap";
import { MAX_ZOOM_IN, MAX_ZOOM_OUT, fitBox, padBox, panBox, zoomBox, type Box } from "../src/ui/viewport";

describe("tap detection", () => {
  it("allows a wobble of up to the slop and no more", () => {
    expect(TAP_SLOP_PX).toBe(6);
    expect(movedTooFar(100, 100, 100, 100)).toBe(false);
    expect(movedTooFar(100, 100, 106, 100)).toBe(false); // exactly 6 px is still a tap
    expect(movedTooFar(100, 100, 106.1, 100)).toBe(true);
    expect(movedTooFar(100, 100, 104, 104)).toBe(false); // 5.7 px diagonally
    expect(movedTooFar(100, 100, 105, 105)).toBe(true); // 7.1 px diagonally
  });

  it("counts a single pointer that goes down and up in place as a tap", () => {
    const t = createTapTracker();
    t.down(1, 10, 10, 1);
    t.move(12, 11, 1);
    expect(t.end(1, true)).toBe(true);
  });

  it("is not a tap after a drag, even one that comes back to where it started", () => {
    const t = createTapTracker();
    t.down(1, 10, 10, 1);
    t.move(40, 10, 1);
    t.move(10, 10, 1);
    expect(t.end(1, true)).toBe(false);
  });

  it("is not a tap when a second pointer joins, when cancelled, or for another pointer", () => {
    const t = createTapTracker();
    t.down(1, 10, 10, 1);
    t.down(2, 50, 50, 2);
    expect(t.end(2, true)).toBe(false);
    expect(t.end(1, true)).toBe(false);
    t.down(3, 10, 10, 1);
    expect(t.end(3, false)).toBe(false); // pointercancel
    t.down(4, 10, 10, 1);
    expect(t.end(5, true)).toBe(false);
    expect(t.end(4, true)).toBe(false); // the other pointer's end cleared the tap
  });

  it("is not a tap when the move was made with two pointers down", () => {
    const t = createTapTracker();
    t.down(1, 10, 10, 1);
    t.move(10, 10, 2);
    expect(t.end(1, true)).toBe(false);
  });
});

describe("viewport boxes", () => {
  const whole: Box = padBox({ x: 0, y: 0, w: 1000, h: 500 }, 10);

  it("pads on every side", () => {
    expect(whole).toEqual({ x: -10, y: -10, w: 1020, h: 520 });
  });

  it("keeps the point under the pointer fixed when zooming", () => {
    const vb = zoomBox(whole, whole, 300, 200, 0.5);
    expect(vb.w).toBeCloseTo(510, 9);
    expect(vb.h).toBeCloseTo(260, 9);
    // The map point (300, 200) sits at the same share of the box as before.
    expect((300 - vb.x) / vb.w).toBeCloseTo((300 - whole.x) / whole.w, 9);
    expect((200 - vb.y) / vb.h).toBeCloseTo((200 - whole.y) / whole.h, 9);
  });

  it("stops zooming at the limits", () => {
    expect(zoomBox(whole, whole, 0, 0, 100).w).toBeCloseTo(whole.w * MAX_ZOOM_OUT, 9);
    expect(zoomBox(whole, whole, 0, 0, 0.0001).w).toBeCloseTo(whole.w / MAX_ZOOM_IN, 9);
  });

  it("pans by the share of the box the pointer travelled", () => {
    const vb = panBox(whole, 100, -50, 1000, 500);
    expect(vb.x).toBeCloseTo(whole.x - 0.1 * whole.w, 9);
    expect(vb.y).toBeCloseTo(whole.y + 0.1 * whole.h, 9);
    expect(vb.w).toBe(whole.w);
  });

  it("fits hexes with a margin in the shape of the screen", () => {
    const vb = fitBox([[0, 0], [100, 40]], 2, 30);
    expect(vb.w / vb.h).toBeCloseTo(2, 9);
    expect(vb.x + vb.w / 2).toBeCloseTo(50, 9);
    expect(vb.y + vb.h / 2).toBeCloseTo(20, 9);
    expect(vb.w).toBeGreaterThanOrEqual(160); // 100 wide plus a margin each side
    expect(vb.h).toBeGreaterThanOrEqual(100);
  });
});
