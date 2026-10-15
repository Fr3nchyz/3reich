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
    zoomMiddle: () => undefined,
    level: () => 1,
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

  it("reads the gap between the fingers when the second one lands, so the first move of a pinch counts", () => {
    const { ptr, calls } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointerdown", 2, 200, 100); // gap 100
    ptr("pointermove", 2, 300, 100); // gap 200 at once: zoomed, about the new middle (200, 100), after a pan of the middle (50)
    expect(calls).toEqual(["pan 50,0", "zoom 200,100 x0.500"]);
  });

  it("moves the map when two fingers travel together and does not zoom it", () => {
    const { ptr, calls } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointerdown", 2, 200, 100);
    ptr("pointermove", 1, 140, 100); // gap 60 ...
    ptr("pointermove", 2, 240, 100); // ... and back to 100
    const zooms = calls.filter((c) => c.startsWith("zoom")).map((c) => Number(c.split("x")[1]));
    expect(zooms.reduce((a, b) => a * b, 1)).toBeCloseTo(1);
    expect(calls.filter((c) => c.startsWith("pan")).map((c) => Number(c.split(" ")[1]!.split(",")[0])).reduce((a, b) => a + b, 0)).toBeCloseTo(40);
  });

  it("ignores a pinch whose fingers touch (no division by zero)", () => {
    const { ptr, calls } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointerdown", 2, 100, 100);
    ptr("pointermove", 2, 150, 100);
    expect(calls.filter((c) => c.startsWith("zoom"))).toEqual([]);
  });

  it("starts a fresh pinch when a third finger lifts, and a lone finger afterwards pans without a tap", () => {
    const { ptr, calls, taps } = setup();
    ptr("pointerdown", 1, 100, 100);
    ptr("pointerdown", 2, 200, 100);
    ptr("pointerdown", 3, 400, 100);
    ptr("pointermove", 3, 450, 100); // three fingers: no pinch
    ptr("pointerup", 3, 450, 100);
    ptr("pointermove", 2, 300, 100); // back to two: the gap is read from the lift, so the first move counts
    expect(calls.filter((c) => c.startsWith("zoom"))).toEqual(["zoom 200,100 x0.500"]);
    ptr("pointerup", 2, 300, 100);
    ptr("pointermove", 1, 120, 100);
    ptr("pointerup", 1, 120, 100);
    expect(taps).toEqual([]);
  });

  it("keeps Safari from zooming the page: the gesture events and a two-finger touchmove are cancelled", () => {
    const { fire } = setup();
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      let stopped = false;
      fire(type, { scale: 1, clientX: 0, clientY: 0, preventDefault: () => { stopped = true; } });
      expect(stopped, type).toBe(true);
    }
    const stopIf = (touches: number) => { let stopped = false; fire("touchmove", { touches: { length: touches }, preventDefault: () => { stopped = true; } }); return stopped; };
    expect(stopIf(2)).toBe(true);
    expect(stopIf(1), "one finger is left alone").toBe(false);
  });

  it("zooms the map for a trackpad pinch (a gesture with no pointers down), but not for a touch pinch, which the pointers already handle", () => {
    const { fire, ptr, calls } = setup();
    fire("gesturestart", { scale: 1 });
    fire("gesturechange", { scale: 2, clientX: 50, clientY: 60 });
    fire("gesturechange", { scale: 3, clientX: 50, clientY: 60 });
    expect(calls).toEqual(["zoom 50,60 x0.500", "zoom 50,60 x0.667"]);
    ptr("pointerdown", 1, 0, 0);
    ptr("pointerdown", 2, 100, 0);
    fire("gesturestart", { scale: 1 });
    fire("gesturechange", { scale: 2, clientX: 50, clientY: 0 });
    expect(calls).toHaveLength(2);
  });

  it("ignores moves of a pointer that is not down", () => {
    const { ptr, calls } = setup();
    ptr("pointermove", 9, 10, 10);
    expect(calls).toEqual([]);
  });
});
