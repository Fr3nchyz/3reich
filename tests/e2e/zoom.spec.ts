import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The zoom buttons and the touch checks at iPad sizes (spec 08), in both orientations, with a mouse and with a
 * touch screen: each button works, a real two-finger pinch zooms the map and not the page, a tap on a hex still
 * works afterwards, a double tap does not zoom the page, the zoom survives turning the iPad, and the buttons
 * stay clear of everything else on the map and of the panels.
 */

type Pt = [number, number];
type Rect = { x: number; y: number; width: number; height: number };

const IPADS = [[1024, 768], [1180, 820], [820, 1180], [768, 1024]] as const;
const PHONES = [[390, 844], [360, 640], [844, 390], [568, 320]] as const;

async function start(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.locator("#newgame").click();
  await expect(page.locator(".setup h2")).toContainText("Your setup");
  await page.evaluate(() => document.getElementById("wholemap")!.click());
  await settle(page);
}

/** Waits until the map's viewBox has the shape of the map's box (a resize has been refitted). */
async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.locator("svg.map").evaluate((svg) => {
    const [, , w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number];
    const r = svg.getBoundingClientRect();
    return Math.abs(w / h / (r.width / r.height) - 1) < 0.01;
  })).toBe(true);
}

/** How wide one hex is drawn, in screen pixels: what the player sees. */
const hexPx = (page: Page) => page.locator("svg.map").evaluate((svg) => {
  const [, , w, h] = svg.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number];
  const r = svg.getBoundingClientRect();
  return 17.3205 * Math.min(r.width / w, r.height / h);
});

const box = async (l: Locator): Promise<Rect> => (await l.boundingBox())!;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Rect, outer: Rect) => a.x >= outer.x - 0.5 && a.y >= outer.y - 0.5 && a.x + a.width <= outer.x + outer.width + 0.5 && a.y + a.height <= outer.y + outer.height + 0.5;

const press = (l: Locator, hasTouch: boolean) => (hasTouch ? l.tap() : l.click());
const zoomButton = (page: Page, action: string) => page.locator(`#zoom button[data-zoom="${action}"]`);

for (const [width, height] of [...IPADS, ...PHONES]) {
  test(`${width}x${height}: four named buttons of at least 44 px sit on the map, clear of everything else on it`, async ({ page }) => {
    await start(page, width, height);
    const names = await page.locator("#zoom button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
    expect(names).toEqual(["Zoom in", "Zoom out", "Show the whole map", "Zoom to the selected counter"]);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    // Make the other things on the map show: the key, a long refused-move line.
    await page.locator("#overlay").click();
    await page.evaluate(() => { document.getElementById("maptoast")!.textContent = "That stack cannot get there. The yellow hexes are the places it can."; });
    const map = await box(page.locator(".map-wrap"));
    const others = [".legend", "#hexinfo", "#maptoast", "#overlay", "#status"];
    for (const b of await page.locator("#zoom button").all()) {
      const r = await box(b);
      expect(r.width, "wide enough to touch").toBeGreaterThanOrEqual(44);
      expect(r.height, "tall enough to touch").toBeGreaterThanOrEqual(44);
      expect(inside(r, map), "on the map").toBe(true);
      for (const sel of others) expect(overlaps(r, await box(page.locator(sel))), `clear of ${sel}`).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(width);
  });
}

for (const [width, height] of IPADS) {
  test(`${width}x${height}: the buttons zoom in and out by doubling, stop at the limits, and the whole-map button comes back`, async ({ page, hasTouch }) => {
    await start(page, width, height);
    const whole = await hexPx(page);
    await press(zoomButton(page, "in"), hasTouch);
    expect(await hexPx(page)).toBeCloseTo(whole * 2, 0);
    await expect(page.locator("#zoomsay")).toHaveText("Zoom 2 times");
    await press(zoomButton(page, "in"), hasTouch);
    expect(await hexPx(page)).toBeCloseTo(whole * 4, 0);
    await press(zoomButton(page, "out"), hasTouch);
    expect(await hexPx(page)).toBeCloseTo(whole * 2, 0);
    await press(zoomButton(page, "whole"), hasTouch);
    expect(await hexPx(page)).toBeCloseTo(whole, 0);
    await expect(page.locator("#zoomsay")).toHaveText("Showing the whole map");

    for (let i = 0; i < 6; i++) await press(zoomButton(page, "in"), hasTouch);
    const closest = await hexPx(page);
    expect(closest).toBeCloseTo(whole * 12, 0);
    expect(closest, "a hex is big enough to read and to tap").toBeGreaterThan(100);
    await expect(page.locator("#zoomsay")).toHaveText("Zoomed in as far as it goes");
    await press(zoomButton(page, "in"), hasTouch);
    expect(await hexPx(page), "pressing again changes nothing").toBeCloseTo(closest, 0);

    for (let i = 0; i < 8; i++) await press(zoomButton(page, "out"), hasTouch);
    expect(await hexPx(page)).toBeCloseTo(whole / 1.2, 0);
    await expect(page.locator("#zoomsay")).toHaveText("Zoomed out as far as it goes");
  });

  test(`${width}x${height}: zoom to the selected counter fits the outlined hexes, and a tap on one still places the counter`, async ({ page, hasTouch }) => {
    await start(page, width, height);
    const whole = await hexPx(page);
    await page.locator(".setup button[data-spec]").first().click(); // the counter to place next: its places are outlined
    await press(zoomButton(page, "selected"), hasTouch);
    await expect(page.locator("#zoomsay")).toHaveText("Zoomed to the selected counter");
    expect(await hexPx(page)).toBeGreaterThan(whole * 1.5);
    const svg = await box(page.locator("svg.map"));
    for (const hl of await page.locator("g.highlights polygon").all()) expect(inside(await box(hl), svg), "every outlined hex is on screen").toBe(true);

    const before = await page.locator("g.units > g").count();
    const spot = await box(page.locator("g.highlights polygon").first());
    if (hasTouch) await page.touchscreen.tap(spot.x + spot.width / 2, spot.y + spot.height / 2);
    else await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await expect(page.locator("g.units > g")).toHaveCount(before + 1);
  });

  test(`${width}x${height}: the zoom survives turning the iPad over and turning it back`, async ({ page, hasTouch }) => {
    await start(page, width, height);
    await press(zoomButton(page, "in"), hasTouch);
    await press(zoomButton(page, "in"), hasTouch);
    const read = () => page.locator("svg.map").evaluate((svg) => svg.getAttribute("viewBox")!.split(" ").map(Number));
    const before = await read() as [number, number, number, number];
    await page.setViewportSize({ width: height, height: width });
    await settle(page);
    const turned = await read() as [number, number, number, number];
    expect(turned[0] + turned[2] / 2, "the same map point stays in the middle").toBeCloseTo(before[0] + before[2] / 2, 0);
    expect(turned[1] + turned[3] / 2).toBeCloseTo(before[1] + before[3] / 2, 0);
    await page.setViewportSize({ width, height });
    await settle(page);
    const back = await read();
    back.forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 0));
    // And the buttons still zoom from there.
    const hex = await hexPx(page);
    await press(zoomButton(page, "in"), hasTouch);
    expect(await hexPx(page)).toBeCloseTo(hex * 2, 0);
  });
}

test("with nothing outlined the target button says so and leaves the map where it is", async ({ page, hasTouch }) => {
  await start(page, 1024, 768);
  for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click(); // finish the set-up: no counter is chosen any more
  await expect(page.locator(".turn")).toContainText("step 1");
  await expect(page.locator("g.highlights polygon")).toHaveCount(0);
  const before = await page.locator("svg.map").getAttribute("viewBox");
  await press(zoomButton(page, "selected"), hasTouch);
  await expect(page.locator("#zoomsay")).toContainText("Nothing is selected");
  expect(await page.locator("svg.map").getAttribute("viewBox")).toBe(before);
});

test.describe("two fingers on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  for (const [width, height] of IPADS) {
    test(`${width}x${height}: a pinch zooms the map and not the page, places nothing, and a tap on a hex still works`, async ({ page }, info) => {
      test.skip(info.project.name !== "touch", "needs a touch screen");
      await start(page, width, height);
      await page.locator(".setup button[data-spec]").first().click();
      const cdp = await page.context().newCDPSession(page);
      const send = (type: "touchStart" | "touchMove" | "touchEnd", pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
      const svg = await box(page.locator("svg.map"));
      const cx = svg.x + svg.width / 2 - 60, cy = svg.y + svg.height / 2; // clear of the buttons in the corner
      const units = await page.locator("g.units > g").count();
      const whole = await hexPx(page);

      await send("touchStart", [[cx - 30, cy], [cx + 30, cy]]);
      for (let i = 1; i <= 16; i++) await send("touchMove", [[cx - 30 - i * 6, cy], [cx + 30 + i * 6, cy]]);
      await send("touchEnd", []);
      const zoomed = await hexPx(page);
      expect(zoomed, "the pinch opened the map up").toBeGreaterThan(whole * 2);
      expect(await page.evaluate(() => window.visualViewport!.scale), "the page itself did not zoom").toBe(1);
      expect(await page.locator("g.units > g").count()).toBe(units);
      await expect(page.locator(".toast")).toBeEmpty();

      // Pinching back in goes the other way.
      await send("touchStart", [[cx - 150, cy], [cx + 150, cy]]);
      for (let i = 1; i <= 10; i++) await send("touchMove", [[cx - 150 + i * 10, cy], [cx + 150 - i * 10, cy]]);
      await send("touchEnd", []);
      expect(await hexPx(page)).toBeLessThan(zoomed);

      // A tap on an outlined hex: bring them on screen with the button, then tap.
      await page.locator('#zoom button[data-zoom="selected"]').tap();
      const spot = await box(page.locator("g.highlights polygon").first());
      await page.touchscreen.tap(spot.x + spot.width / 2, spot.y + spot.height / 2);
      await expect(page.locator("g.units > g")).toHaveCount(units + 1);
    });
  }

  test("1024x768: two fingers moving together move the map and leave the zoom alone, and a double tap zooms nothing", async ({ page }, info) => {
    test.skip(info.project.name !== "touch", "needs a touch screen");
    await start(page, 1024, 768);
    await page.locator('#zoom button[data-zoom="in"]').tap();
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const read = () => page.locator("svg.map").evaluate((svg) => svg.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number]);
    const svg = await box(page.locator("svg.map"));
    const cx = svg.x + svg.width / 2 - 60, cy = svg.y + svg.height / 2;
    const before = await read();
    await send("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
    for (let i = 1; i <= 8; i++) await send("touchMove", [[cx - 40 + i * 10, cy], [cx + 40 + i * 10, cy]]);
    await send("touchEnd", []);
    const after = await read();
    expect(after[2], "same zoom").toBeCloseTo(before[2], 1);
    expect(before[0] - after[0], "the map followed the fingers (80 px to the right)").toBeGreaterThan(0);

    const now = await read();
    const x = svg.x + 30, y = svg.y + svg.height - 60; // a spot on the map with nothing of ours on it
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(60);
    await page.touchscreen.tap(x, y);
    expect(await page.evaluate(() => window.visualViewport!.scale), "no page zoom from a double tap").toBe(1);
    expect(await read(), "and no map zoom either").toEqual(now);
  });
});
