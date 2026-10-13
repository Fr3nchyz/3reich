import { expect, test, type Page } from "@playwright/test";

/**
 * Pan, zoom and tap-versus-drag on the map, in a real browser with a mouse and with touch. The smoke
 * test only taps in place, so a drag that wrongly counted as a tap would pass it.
 */

type Pt = [number, number];

/** Start a new 1939 Axis game, pick the first counter and return the centre of a highlighted hex that is fully on screen. */
async function startAndPick(page: Page): Promise<{ id: string; x: number; y: number }> {
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();
  await page.locator(".setup button[data-spec]").first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(2, 2);
  const hl = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const p of svg.querySelectorAll("g.highlights polygon")) {
      const r = p.getBoundingClientRect();
      if (r.left > Math.max(box.left, 0) + 30 && r.right < Math.min(box.right, innerWidth) - 30 && r.top > Math.max(box.top, 0) + 30 && r.bottom < Math.min(box.bottom, innerHeight) - 30)
        return { id: p.getAttribute("data-hl") ?? "", x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  if (!hl?.id) throw new Error("no highlighted hex is fully visible");
  return hl;
}

/** One pointer going down at `from`, through each point of `path`, and up at the last one (mouse or touch). */
async function gesture(page: Page, hasTouch: boolean, from: Pt, path: Pt[]): Promise<void> {
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

const viewBox = (page: Page) => page.locator("svg.map").getAttribute("viewBox");
const units = (page: Page) => page.locator("g.units > g").count();

test("a drag pans the map and places nothing", async ({ page, hasTouch }) => {
  const { x, y } = await startAndPick(page);
  const before = await viewBox(page);
  const unitsBefore = await units(page);
  const path: Pt[] = Array.from({ length: 8 }, (_, i) => [x + (i + 1) * 6, y + (i + 1) * 3]); // ends 48 px right, 24 px down
  await gesture(page, hasTouch, [x, y], path);
  expect(await viewBox(page)).not.toBe(before);
  expect(await units(page)).toBe(unitsBefore);
  await expect(page.locator(".toast"), "the end of a drag must not count as a tap").toBeEmpty();
});

test("a tap with 5 px of jitter still places the counter", async ({ page, hasTouch }) => {
  const { id, x, y } = await startAndPick(page);
  const unitsBefore = await units(page);
  await gesture(page, hasTouch, [x, y], [[x + 3, y + 4]]);
  await expect(page.locator(`g.units > g[data-at="${id}"]`)).toHaveCount(1);
  expect(await units(page)).toBe(unitsBefore + 1);
});

test("the wheel zooms the map", async ({ page }) => {
  const { x, y } = await startAndPick(page);
  const before = await viewBox(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => viewBox(page)).not.toBe(before);
  const zoomedIn = await viewBox(page);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => viewBox(page)).not.toBe(zoomedIn);
});

test("a two-finger pinch zooms the map and places nothing", async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "pinch needs touch");
  const { x, y } = await startAndPick(page);
  const before = await viewBox(page);
  const unitsBefore = await units(page);
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([px, py], id) => ({ x: px, y: py, id })) });
  await send("touchStart", [[x - 40, y], [x + 40, y]]);
  for (let i = 1; i <= 10; i++) await send("touchMove", [[x - 40 - i * 8, y], [x + 40 + i * 8, y]]);
  await send("touchEnd", []);
  expect(await viewBox(page)).not.toBe(before);
  expect(await units(page)).toBe(unitsBefore);
  await expect(page.locator(".toast")).toBeEmpty();
});
