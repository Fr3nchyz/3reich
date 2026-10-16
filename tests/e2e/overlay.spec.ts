import { expect, test } from "@playwright/test";

/** The control overlay: off by default, a toggle draws and clears it, and toggling never throws. */

test("the control overlay toggles on and off, changing the map and showing its key", async ({ page, hasTouch }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();

  const button = page.locator("#overlay");
  const legend = page.locator("#legend");
  const control = page.locator("g.overlay [data-ctl]");
  const zoc = page.locator("g.overlay [data-zoc]");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(legend).toBeHidden();
  await expect(control).toHaveCount(0);

  const tap = async () => (hasTouch ? button.tap() : button.click());
  await tap();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("who holds the hex");
  await expect(legend).toContainText("Zones of Control");
  await expect(button, "the label stays; only aria-pressed changes").toHaveText("Control and zones");
  expect(await control.count()).toBeGreaterThan(100);
  // Only armor exerts a ZOC on the next hexes (Ref 7.0), and none stands on the map at the start of setup; the hatching itself is tested in tests/map-overlay.test.ts.

  // The overlay follows the game: placing a counter keeps it drawn, and a new game redraws it.
  await page.locator(".setup button[data-spec]").first().click();
  await expect(control.first()).toBeAttached();
  await page.locator("#newgame").click();
  await expect(control.first()).toBeAttached();

  await tap();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(legend).toBeHidden();
  await expect(control).toHaveCount(0);
  await expect(zoc).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("the overlay does not take taps away from the map", async ({ page, hasTouch }) => {
  await page.goto("/");
  await page.locator("#newgame").click();
  await page.locator("#overlay").click();
  await page.locator(".setup button[data-spec]").first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const spot = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const p of svg.querySelectorAll("g.highlights polygon")) {
      const r = p.getBoundingClientRect();
      if (r.left > Math.max(box.left, 0) + 8 && r.right < Math.min(box.right, innerWidth) - 8 && r.top > Math.max(box.top, 0) + 8 && r.bottom < Math.min(box.bottom, innerHeight) - 8) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  });
  if (!spot) throw new Error("no highlighted hex is visible");
  const before = await page.locator("g.units > g").count();
  if (hasTouch) await page.touchscreen.tap(spot.x, spot.y);
  else await page.mouse.click(spot.x, spot.y);
  await expect(page.locator("g.units > g")).toHaveCount(before + 1);
});
