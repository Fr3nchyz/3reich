import { describe, expect, it } from "vitest";
import { ZOOM_STEP, attachGestures } from "../src/ui/gestures";
import type { Viewport } from "../src/ui/viewport";

/** An svg stand-in that records its listeners; the gesture code only uses addEventListener and setPointerCapture. */
function fakeSvg() {
  const handlers = new Map<string, (e: unknown) => void>();
  const svg = { addEventListener: (type: string, h: (e: unknown) => void) => handlers.set(type, h), setPointerCapture: () => undefined };
  const fire = (type: string, e: object) => handlers.get(type)!({ preventDefault: () => undefined, ...e });
  return { svg: svg as unknown as SVGSVGElement, fire };
}

function setup() {
  const { svg, fire } = fakeSvg();
  const calls: string[] = [];
  const taps: [number, number][] = [];
  const viewport: Viewport = {
    zoomAt: (x, y, f) => calls.push(`zoom ${x},${y} x${f.toFixed(3)}`),
    panBy: (dx, dy) => calls.push(`pan ${dx},${dy}`),
    focus: () => undefined,
  };
  attachGestures(svg, viewport, (x, y) => taps.push([x, y]));
  const ptr = (type: string, id: number, x: number, y: number) => fire(type, { type, pointerId: id, clientX: x, clientY: y });
  return { fire, calls, taps, ptr };
}

describe("gestures on the map", () => {
  it("zooms out for a downward wheel notch and in for an upward one, by one step", () => {
    expect(ZOOM_STEP).toBe(1.15);
    const { fire, calls } = setup();
    fire("wheel", { clientX: 5, clientY: 6, deltaY: 100 });
    fire("wheel", { clientX: 5, clientY: 6, deltaY: -100 });
    expect(calls).toEqual(["zoom 5,6 x1.150", "zoom 5,6 x0.870"]);
  });

  it("reports a tap that stayed within the slop, even with some jitter", () => {
    const { ptr, taps, calls } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointermove", 1, 103, 104); // 5 px of jitter
    ptr("pointerup", 1, 103, 104);
    expect(taps).toEqual([[103, 104]]);
    expect(calls).toEqual(["pan 3,4"]);
  });

  it("does not report a drag as a tap, and pans by what the pointer moved", () => {
    const { ptr, taps, calls } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointermove", 1, 150, 100);
    ptr("pointermove", 1, 160, 120);
    ptr("pointerup", 1, 160, 120);
    expect(taps).toEqual([]);
    expect(calls).toEqual(["pan 50,0", "pan 10,20"]);
  });

  it("does not report a cancelled pointer as a tap", () => {
    const { ptr, taps } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointercancel", 1, 100, 100);
    expect(taps).toEqual([]);
  });

  it("pinches: two pointers zoom about their midpoint by the change in distance and never tap", () => {
    const { ptr, taps, calls } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointerdown", 2, 200, 100);
    ptr("pointermove", 1, 100, 100); // first reading of the distance (100): no zoom yet
    ptr("pointermove", 2, 300, 100); // distance 200: the map content doubles, the view halves
    ptr("pointerup", 2, 300, 100);
    ptr("pointerup", 1, 100, 100);
    expect(calls.filter((c) => c.startsWith("zoom"))).toEqual(["zoom 200,100 x0.500"]);
    expect(taps).toEqual([]);
  });

  it("ignores moves of a pointer that is not down", () => {
    const { ptr, calls } = setup();
    ptr("pointermove", 9, 10, 10);
    expect(calls).toEqual([]);
  });
});
