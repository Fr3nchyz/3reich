import { expect, test, type Locator, type Page } from "@playwright/test";

/** Centre of the first highlighted hex that is fully inside the part of the map the viewport shows. */
async function visibleHighlightCentre(page: Page): Promise<{ x: number; y: number }> {
  // Clicking a chip below the map can scroll the map out of view.
  await page.evaluate(() => window.scrollTo(0, 0));
  const centre = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const area = { left: Math.max(box.left, 0), right: Math.min(box.right, window.innerWidth), top: Math.max(box.top, 0), bottom: Math.min(box.bottom, window.innerHeight) };
    for (const hl of svg.querySelectorAll("g.highlights polygon")) {
      const r = hl.getBoundingClientRect();
      const inside = r.left > area.left + 8 && r.right < area.right - 8 && r.top > area.top + 8 && r.bottom < area.bottom - 8;
      if (inside) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  if (!centre) throw new Error("no highlighted hex is visible on the map");
  return centre;
}

const poolCount = async (chip: Locator): Promise<number> => Number(/^\s*(\d+)\s*×/.exec(await chip.innerText())?.[1]);

test("1939 scenario, Axis: pick a counter, tap a highlighted hex, the counter is placed", async ({ page, hasTouch }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();

  await expect(page.locator(".setup h2")).toContainText("Your setup");

  // Choose a counter chip; its hexes are highlighted yellow on the map.
  const chip = page.locator(".setup button[data-spec]").first();
  const key = await chip.getAttribute("data-spec");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("g.highlights polygon").first()).toBeAttached();

  const before = await poolCount(chip);
  const markersBefore = await page.locator("g.units > g").count();
  const { x, y } = await visibleHighlightCentre(page);
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);

  // A unit marker appears on the map and the pool count drops (the chip disappears with the last counter).
  await expect(page.locator("g.units > g")).toHaveCount(markersBefore + 1);
  const same = page.locator(`.setup button[data-spec="${key}"]`);
  if (before > 1) await expect(same).toContainText(`${before - 1} ×`);
  else await expect(same).toHaveCount(0);
  await expect(page.locator(".setup")).toContainText("On the map: 1");
  await expect(page.locator(".toast")).toBeEmpty();

  expect(pageErrors).toEqual([]);
});
