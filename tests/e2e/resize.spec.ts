import { expect, test, type Page } from "@playwright/test";

/**
 * The map's box changes shape when the window is dragged across the two-column breakpoint, the browser is
 * zoomed or a tablet is turned: the map must be refitted (nothing cropped or letterboxed), and pan and zoom
 * must stay exact afterwards (a drag of 100 px moves the map 100 px; a zoom keeps the point under the pointer).
 */

type Pt = [number, number];

const SEQUENCE = [[1280, 720], [800, 600], [1000, 700], [1280, 720], [844, 390], [390, 844], [1024, 768], [768, 1024], [1920, 1080]] as const;

async function start(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.locator("#newgame").click();
  await expect(page.locator(".setup h2")).toContainText("Your setup");
  await wholeMap(page); // setup zooms to the first nation; the tests start from the whole map
  await settle(page);
}

/** Waits until the map's viewBox has the shape of the map's box (the refit has run). */
async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.locator("svg.map").evaluate((svg) => {
    const [, , w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number];
    const r = svg.getBoundingClientRect();
    return Math.abs(w / h / (r.width / r.height) - 1) < 0.01;
  })).toBe(true);
}

const wholeMap = (page: Page) => page.evaluate(() => document.getElementById("wholemap")!.click());

/** The hex nearest the middle of the map box: its id and centre on screen. */
const centreHex = (page: Page) =>
  page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    let best: { id: string; x: number; y: number; d: number } | null = null;
    for (const p of svg.querySelectorAll("g.hexes polygon[data-id]")) {
      const r = p.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d) best = { id: p.getAttribute("data-id")!, x, y, d };
    }
    return best!;
  });

const hexCentre = (page: Page, id: string) =>
  page.locator(`svg.map g.hexes polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

/** Pointer or finger down at `from`, through `path`, up at the end. */
async function drag(page: Page, hasTouch: boolean, from: Pt, path: Pt[]): Promise<void> {
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    await send("touchStart", [from]);
    for (const p of path) await send("touchMove", [p]);
    await send("touchEnd", []);
  } else {
    await page.mouse.move(...from);
    await page.mouse.down();
    for (const p of path) await page.mouse.move(...p);
    await page.mouse.up();
  }
}

/** Zooms in about (x, y): the wheel with a mouse, a pinch with fingers. */
async function zoomIn(page: Page, hasTouch: boolean, [x, y]: Pt): Promise<void> {
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([px, py], id) => ({ x: px, y: py, id })) });
    await send("touchStart", [[x - 30, y], [x + 30, y]]);
    for (let i = 1; i <= 8; i++) await send("touchMove", [[x - 30 - i * 6, y], [x + 30 + i * 6, y]]);
    await send("touchEnd", []);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -400);
  }
}

for (const [i, [width, height]] of SEQUENCE.entries()) {
  test(`resized to ${width}x${height} (step ${i}): the map is refitted, a 100 px drag moves it 100 px, a zoom keeps the point under the pointer`, async ({ page, hasTouch }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Start from the size before this one in the sequence, then resize: the map was drawn for another shape.
    const [pw, ph] = SEQUENCE[(i + SEQUENCE.length - 1) % SEQUENCE.length]!;
    await start(page, pw, ph);
    await page.setViewportSize({ width, height });
    await settle(page);

    // The map block is on screen and the whole map is still entirely inside its box.
    const dock = (await page.locator(".map-dock").boundingBox())!;
    expect(dock.y).toBeGreaterThanOrEqual(0);
    expect(dock.y + dock.height).toBeLessThanOrEqual(height + 1);
    // The whole map was in view before the resize and still is: the view is exactly what "Whole map" gives at this size.
    const vbOf = () => page.locator("svg.map").getAttribute("viewBox").then((s) => s!.split(" ").map(Number));
    const refitted = await vbOf();
    await wholeMap(page);
    await settle(page);
    const whole = await vbOf();
    for (const [k, v] of refitted.entries()) expect(Math.abs(v - whole[k]!), `viewBox[${k}] is the whole map's`).toBeLessThan(Math.max(1, Math.abs(whole[k]!) * 0.005));

    // Pan: the map moves exactly as far as the drag.
    await page.evaluate(() => window.scrollTo(0, 0));
    const hex = await centreHex(page);
    const path: Pt[] = Array.from({ length: 10 }, (_, k) => [hex.x + (k + 1) * 10, hex.y]);
    await drag(page, hasTouch, [hex.x, hex.y], path);
    const panned = await hexCentre(page, hex.id);
    expect(panned.x - hex.x, "a 100 px drag moves the map 100 px").toBeCloseTo(100, 0);
    expect(Math.abs(panned.y - hex.y)).toBeLessThan(1.5);

    // Zoom: the hex under the pointer stays under the pointer.
    await wholeMap(page);
    await settle(page);
    const target = await centreHex(page);
    await zoomIn(page, hasTouch, [target.x, target.y]);
    await expect.poll(async () => (await centreHex(page)).id).toBeDefined();
    const after = await hexCentre(page, target.id);
    expect(Math.abs(after.x - target.x), "zoom anchors under the pointer (x)").toBeLessThan(3);
    expect(Math.abs(after.y - target.y), "zoom anchors under the pointer (y)").toBeLessThan(3);
    expect(errors).toEqual([]);
  });
}

test("a zoomed-in map keeps its centre and zoom level across a resize and back", async ({ page, hasTouch }) => {
  await start(page, 1280, 720);
  const first = await centreHex(page);
  await zoomIn(page, hasTouch, [first.x, first.y]);
  const before = await hexCentre(page, first.id);
  const sizeBefore = await page.locator(`svg.map g.hexes polygon[data-id="${first.id}"]`).evaluate((p) => p.getBoundingClientRect().width);
  const box = (await page.locator("svg.map").boundingBox())!;
  const frac = { x: (before.x - box.x) / box.width, y: (before.y - box.y) / box.height };
  await page.setViewportSize({ width: 800, height: 600 });
  await settle(page);
  const small = (await page.locator("svg.map").boundingBox())!;
  const mid = await hexCentre(page, first.id);
  expect(Math.abs((mid.x - small.x) / small.width - frac.x), "the same map point stays at the same place in the box").toBeLessThan(0.03);
  expect(Math.abs((mid.y - small.y) / small.height - frac.y)).toBeLessThan(0.03);
  await page.setViewportSize({ width: 1280, height: 720 });
  await settle(page);
  const sizeAfter = await page.locator(`svg.map g.hexes polygon[data-id="${first.id}"]`).evaluate((p) => p.getBoundingClientRect().width);
  expect(Math.abs(sizeAfter / sizeBefore - 1), "back at the old size, the old zoom").toBeLessThan(0.02);
});
