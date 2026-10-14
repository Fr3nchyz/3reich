import { expect, test } from "@playwright/test";

/** Step 8b in a real browser: choose a counter to build, tap one of the yellow hexes, and the counter stands there. */

test("1939, Axis: get to construction, pick a counter, tap a yellow hex, the counter is built", async ({ page, hasTouch }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();
  for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();

  // Step 1 (declarations of war): declare nothing. Step 3 (Front Options): Germany's opening Eastern Front Offensive Option (free), then on to step 8b.
  await expect(page.locator(".turn")).toContainText("step 1");
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 3");
  await expect(page.locator(".note").filter({ hasText: "Front Options (step 3)" })).toBeVisible();
  await page.locator("summary", { hasText: "Choose a Front Option" }).click();
  await page.getByRole("button", { name: "Eastern Front: Offensive Option", exact: true }).click();
  await expect(page.locator(".log li").last()).toContainText("Axis choose the Offensive Option on the Eastern Front.");
  await page.locator(".actions button[data-action]").last().click();
  // Step 6f (ground movement): move nothing.
  await expect(page.locator(".turn")).toContainText("step 6f");
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 8b");
  await expect(page.locator(".build h2")).toHaveText("Construction");

  const chip = page.locator('button[data-build="germany:infantry:3"]');
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("g.highlights polygon").first()).toBeAttached();

  await page.locator("#map").scrollIntoViewIfNeeded();
  const before = await page.locator("g.units > g").count();
  const pt = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const h of svg.querySelectorAll("g.highlights polygon")) {
      const r = h.getBoundingClientRect();
      if (r.left > Math.max(box.left, 0) + 8 && r.right < Math.min(box.right, window.innerWidth) - 8 && r.top > Math.max(box.top, 0) + 8 && r.bottom < Math.min(box.bottom, window.innerHeight) - 8) return [r.left + r.width / 2, r.top + r.height / 2];
    }
    return null;
  });
  if (!pt) throw new Error("no yellow hex is visible on the map");
  if (hasTouch) await page.touchscreen.tap(pt[0]!, pt[1]!);
  else await page.mouse.click(pt[0]!, pt[1]!);

  await expect(page.locator("g.units > g")).toHaveCount(before + 1);
  await expect(page.locator(".log li").last()).toContainText("Germany builds a 3-factor infantry");
  await expect(page.locator(".toast")).toBeEmpty();
  expect(errors).toEqual([]);
});
