import { describe, expect, it } from "vitest";
import { MIN_PINCH_GAP_PX, pinchStep, readFingers } from "../src/ui/pinch";

/** The two-finger gesture as pure maths (spec 08). */

describe("readFingers", () => {
  it("is the middle between the fingers and the gap", () => {
    expect(readFingers({ x: 100, y: 100 }, { x: 160, y: 180 })).toEqual({ mx: 130, my: 140, d: 100 });
  });
});

describe("pinchStep", () => {
  const at = (ax: number, bx: number) => readFingers({ x: ax, y: 0 }, { x: bx, y: 0 });

  it("spreading the fingers shows less of the map (factor under 1), closing them shows more", () => {
    expect(pinchStep(at(100, 200), at(100, 300)).factor).toBe(0.5);
    expect(pinchStep(at(100, 300), at(100, 200)).factor).toBe(2);
  });

  it("two fingers moving together move the map by what the middle moved, and do not zoom", () => {
    const step = pinchStep(readFingers({ x: 100, y: 100 }, { x: 200, y: 100 }), readFingers({ x: 130, y: 120 }, { x: 230, y: 120 }));
    expect(step).toEqual({ panX: 30, panY: 20, factor: 1 });
  });

  it("does not zoom when the fingers are (nearly) on top of each other: no division by zero", () => {
    expect(pinchStep(at(100, 100), at(100, 150)).factor).toBe(1);
    expect(pinchStep(at(100, 150), at(100, 100)).factor).toBe(1);
    expect(pinchStep(at(100, 100 + MIN_PINCH_GAP_PX - 1), at(100, 200)).factor).toBe(1);
    expect(pinchStep(at(100, 100 + MIN_PINCH_GAP_PX), at(100, 200)).factor).toBeCloseTo(MIN_PINCH_GAP_PX / 100);
  });

  it("a step of one finger at a time telescopes: the same end gap gives the same total zoom", () => {
    // Finger A moves 10 right, then finger B moves 10 right: the gap is 60 before and after, so the total zoom is 1.
    const start = at(0, 60), mid = at(10, 60), end = at(10, 70);
    expect(pinchStep(start, mid).factor * pinchStep(mid, end).factor).toBeCloseTo(1);
  });
});
