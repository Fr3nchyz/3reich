import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The Free Siberian Transfer on the screen (spec 14, ticket 14-18; part D6) in a real browser, with a mouse and with a finger, at phone and iPad sizes. One recorded game
 * (tests/e2e/fixtures/siberian-card.json, written by scripts/make-e2e-fixture.ts, loaded with the `?e2e` hook): a 1942 game of the computer cut where the Allied Player Turn
 * of Spring 1942 reaches step 8a. For the Allies the card offers the counters of the Russian pool and the cities; for the Axis the computer, playing the Allies, takes the units.
 */

type Fixture = { scenario: string; seed: number; actions: unknown[] };
const CARD = JSON.parse(readFileSync("tests/e2e/fixtures/siberian-card.json", "utf8")) as Fixture;
type Size = readonly [number, number];
const SIZES: readonly Size[] = [[390, 844], [768, 1024], [1024, 768], [1180, 820]];

async function load(page: Page, side: "axis" | "allies", size?: Size): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: CARD.scenario, side, seed: CARD.seed, actions: CARD.actions });
  return errors;
}

for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: the card shows the quota, the pool and the rules, the heading has the focus, and every button is a touch target`, async ({ page }) => {
    const errors = await load(page, "allies", size);
    const card = page.locator("#siberian-card");
    await expect(card).toBeVisible();
    await expect(page.locator(".turn")).toContainText("step 8a (Possible Free Siberian Transfer)");
    await expect(page.locator("#siberian-title")).toBeFocused();
    await expect(page.locator("#siberian-title")).toHaveText("Free Siberian Transfer");
    await expect(card).toContainText("You may take 3 units this turn (Spring 1942).");
    await expect(card).toContainText("Armor taken may not outnumber infantry taken: take infantry first.");
    await expect(card).toContainText("Using this raises the Allied targets by one objective.");
    await expect(card.locator("button[data-siberian]").first()).toBeVisible();
    await expect(card.locator('button[data-siberian^="armor"]')).toBeDisabled();
    await expect(card.locator('button[data-siberian^="infantry"]').first()).toBeEnabled();
    await expect(card.locator(".siberian-buttons button")).toHaveText(["Do not take any"]);
    for (const b of await card.locator("button").all()) {
      await b.scrollIntoViewIfNeeded(); // a new game scrolls the page to the map, so on a phone the card sits below the fold until the player scrolls to it
      await expect(b).toBeInViewport();
      expect((await b.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(44);
    }
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size[0] + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(size[0]);
    expect(await page.locator("main").innerText()).not.toContain("SIBERIAN_TRANSFER");
    expect(errors).toEqual([]);
  });
}

test("pick a counter, press a city: the unit is built free, the log says so, the count goes down and the targets are one higher", async ({ page }) => {
  const errors = await load(page, "allies");
  const card = page.locator("#siberian-card");
  const chip = card.locator('button[data-siberian="infantry:3"]');
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("Cities for the 3-3 infantry:");
  const cities = card.locator("button[data-siberian-city]");
  const count = await cities.count();
  expect(count).toBeGreaterThan(10);
  for (const b of await cities.all()) expect((await b.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(44);
  const units = await page.locator("g.units > g").count();
  const brps = await page.locator("main table tbody tr", { hasText: "Soviet Union" }).locator("td").nth(2).innerText();
  await card.locator('button[data-siberian-city="H47"]').click();
  await expect(page.locator(".log li").first()).toContainText("Free Siberian Transfer: a 3-factor infantry appears in Moscow (H47). 2 more may be taken this turn. The Allied targets are now one objective higher.");
  await expect(page.locator("#siberian-card")).toContainText("You may take 2 more units this turn (3 in Spring 1942; 1 taken).");
  await expect(page.locator("#siberian-card")).toContainText("The Allied targets are already one objective higher.");
  await expect(page.locator("#siberian-card .siberian-buttons button")).toHaveText(["Done taking units"]);
  expect(await page.locator("main table tbody tr", { hasText: "Soviet Union" }).locator("td").nth(2).innerText(), "free of charge").toBe(brps);
  await expect(page.locator("main .toast")).toBeEmpty();
  // The Objectives card says the Transfer is in use.
  await page.locator("#obj-open").click();
  await expect(page.locator(".objcard")).toContainText("Free Siberian Transfer: in use. The Allied targets are one objective higher.");
  expect(errors).toEqual([]);
});

test("pick a counter, tap a yellow hex of the map: the unit stands there", async ({ page, hasTouch }) => {
  const errors = await load(page, "allies");
  await page.locator('#siberian-card button[data-siberian="infantry:3"]').click();
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
  await expect(page.locator(".log li").first()).toContainText("Free Siberian Transfer: a 3-factor infantry appears in");
  await expect(page.locator("main .toast")).toBeEmpty();
  expect(errors).toEqual([]);
});

test("armor waits for infantry: its chip is switched on once an infantry counter is taken, and the quota ends the choice", async ({ page }) => {
  const errors = await load(page, "allies");
  const card = page.locator("#siberian-card");
  await expect(card.locator('button[data-siberian^="armor"]')).toBeDisabled();
  await card.locator('button[data-siberian="infantry:3"]').click();
  await card.locator('button[data-siberian-city="H47"]').click();
  await expect(card.locator('button[data-siberian^="armor"]')).toBeEnabled();
  await card.locator('button[data-siberian="infantry:3"]').click();
  await card.locator('button[data-siberian-city="E54"]').click();
  await card.locator('button[data-siberian="infantry:3"]').click();
  await card.locator('button[data-siberian-city="G46"]').click();
  await expect(card).toContainText("You have taken every unit this turn allows.");
  await expect(card.locator("button[data-siberian-city]")).toHaveCount(0);
  await expect(card.locator('button[data-siberian]:not([disabled])')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("'Do not take any' leaves the step with nothing taken and no change to the targets; the card goes", async ({ page }) => {
  const errors = await load(page, "allies");
  await page.locator("#siberian-card .siberian-buttons button", { hasText: "Do not take any" }).click();
  await expect(page.locator(".turn")).toContainText("step 8b");
  await expect(page.locator("#siberian-card")).toHaveCount(0);
  await expect(page.locator(".log li", { hasText: "Free Siberian Transfer" })).toHaveCount(0);
  await page.locator("#obj-open").click();
  await expect(page.locator(".objcard")).toContainText("Free Siberian Transfer: not used.");
  expect(errors).toEqual([]);
});

test("'Done taking units' leaves the step after units were taken", async ({ page }) => {
  const errors = await load(page, "allies");
  await page.locator('#siberian-card button[data-siberian="infantry:3"]').click();
  await page.locator('#siberian-card button[data-siberian-city="H47"]').click();
  await page.locator("#siberian-card .siberian-buttons button", { hasText: "Done taking units" }).click();
  await expect(page.locator(".turn")).toContainText("step 8b");
  await expect(page.locator("#siberian-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a human Axis player is not asked: the computer, playing the Allies, takes the units, the log shows its reason, and the game goes on", async ({ page }) => {
  const errors = await load(page, "axis");
  await expect(page.locator("ol.log li", { hasText: /^Computer \(Allied\): Free Siberian Transfer: takes a 3-factor infantry/ })).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator("#siberian-card")).toHaveCount(0);
  await expect(page.locator(".turn")).not.toContainText("step 8a");
  await expect(page.locator("ol.log li", { hasText: /^Free Siberian Transfer: a 3-factor infantry appears in/ })).toHaveCount(3);
  expect(errors).toEqual([]);
});
