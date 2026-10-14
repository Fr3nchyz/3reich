import { expect, test, type Page } from "@playwright/test";

/** Water edges (drawing only): the layer is there, is cheap, and never gets in the way of taps, pans and zooms. */

const SIZES = [[1280, 720], [390, 844]] as const;

async function start(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.locator("#newgame").click();
  await expect(page.locator(".setup h2")).toContainText("Your setup");
  await page.evaluate(() => document.getElementById("wholemap")!.click());
}

for (const [width, height] of SIZES) {
  test(`${width}x${height}: the water edge layer has its 222 segments in two paths, and the map stays cheap`, async ({ page }) => {
    await start(page, width, height);
    const layer = await page.locator("svg.map g.wateredges").evaluate((g) => ({
      paths: g.querySelectorAll("path").length,
      segments: [...g.querySelectorAll("path")].map((p) => (p.getAttribute("d")!.match(/M/g) ?? []).length),
      pointerEvents: [...g.querySelectorAll("path")].map((p) => getComputedStyle(p).pointerEvents),
      widths: [...g.querySelectorAll("path")].map((p) => parseFloat(getComputedStyle(p).strokeWidth)),
    }));
    expect(layer.paths).toBe(2);
    expect(layer.segments).toEqual([222, 222]);
    expect(layer.pointerEvents).toEqual(["none", "none"]);
    expect(layer.widths[0], "the band is heavier than a normal edge (0.3) and a river (1.4)").toBeGreaterThan(2);
    // Above the hexes, under the counters.
    const order = await page.locator("svg.map > g").evaluateAll((gs) => gs.map((g) => g.getAttribute("class")));
    expect(order.indexOf("hexes")).toBeLessThan(order.indexOf("wateredges"));
    expect(order.indexOf("wateredges")).toBeLessThan(order.indexOf("units"));
    expect(order.indexOf("wateredges")).toBeLessThan(order.indexOf("arrows"));
    // About 6,200 nodes before; the layer adds two.
    expect(await page.locator("svg.map *").count()).toBeLessThan(6400);
  });

  test(`${width}x${height}: a tap on a water edge reaches the hex under it; pan and zoom still work`, async ({ page, hasTouch }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await start(page, width, height);
    await page.locator(".setup button[data-spec]").first().click();
    await page.evaluate(() => window.scrollTo(0, 0));
    // The middle of the Otranto edge between Brindisi (AA25) and Durazzo (AA26).
    const mid = await page.locator("svg.map").evaluate((svg) => {
      const c = (id: string) => { const r = svg.querySelector(`g.hexes polygon[data-id="${id}"]`)!.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] as const; };
      const a = c("AA25"), b = c("AA26");
      const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      return { x, y, hit: document.elementFromPoint(x, y)?.getAttribute("data-id") ?? null };
    });
    expect(["AA25", "AA26"], "the water edge does not catch the pointer").toContain(mid.hit);
    const before = await page.locator("g.units > g").count();
    if (hasTouch) await page.touchscreen.tap(mid.x, mid.y);
    else await page.mouse.click(mid.x, mid.y);
    expect(await page.locator("g.units > g").count()).toBeGreaterThanOrEqual(before); // placed or refused, never an error

    // Pan and zoom leave the layer in place.
    const vb = await page.locator("svg.map").getAttribute("viewBox");
    if (hasTouch) {
      const cdp = await page.context().newCDPSession(page);
      const send = (type: "touchStart" | "touchMove" | "touchEnd", pts: [number, number][]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
      await send("touchStart", [[mid.x, mid.y]]);
      for (let i = 1; i <= 6; i++) await send("touchMove", [[mid.x + i * 10, mid.y]]);
      await send("touchEnd", []);
    } else {
      await page.mouse.move(mid.x, mid.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(mid.x + i * 10, mid.y);
      await page.mouse.up();
      await page.mouse.wheel(0, -300);
    }
    await expect.poll(() => page.locator("svg.map").getAttribute("viewBox")).not.toBe(vb);
    await expect(page.locator("svg.map g.wateredges path")).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}
