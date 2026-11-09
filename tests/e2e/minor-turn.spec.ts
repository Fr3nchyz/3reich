import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Spec 15 R15, ticket 15-18 slice B: the own turn of an attacked minor (step 4) in a real browser. The game is loaded from tests/e2e/fixtures/minor-step4.json
 * (the `?e2e` hook): the Allied human stands at step 4 of Spring 1940 with Belgium attacked by Germany and its units able to move.
 */
type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/minor-step4.json", "utf8")) as { scenario: string; seed: number; actions: unknown[] };

async function load(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "allies", seed: FIXTURE.seed, actions: FIXTURE.actions });
  await expect(page.locator(".turn")).toContainText("step 4");
  return errors;
}

async function tapAt(page: Page, touch: boolean, pt: Pt): Promise<void> {
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}

function visibleCentres(page: Page, selector: string): Promise<Pt[]> {
  return page.locator("svg.map").evaluate((svg, sel) => {
    const box = svg.getBoundingClientRect();
    const out: [number, number][] = [];
    for (const h of svg.querySelectorAll(sel)) {
      const r = h.getBoundingClientRect();
      if (r.left > Math.max(box.left, 0) + 8 && r.right < Math.min(box.right, window.innerWidth) - 8 && r.top > Math.max(box.top, 0) + 8 && r.bottom < Math.min(box.bottom, window.innerHeight) - 8) out.push([r.left + r.width / 2, r.top + r.height / 2]);
    }
    return out;
  }, selector);
}

test("step 4: the bar names the minor, a minor's stack moves by tap, and Done with step 4 passes", async ({ page, hasTouch }) => {
  test.setTimeout(120_000);
  const errors = await load(page);
  await expect(page.locator(".next-text")).toContainText("Belgium");
  await expect(page.locator(".next-text")).toContainText("own turn");
  await expect(page.locator(".movelist")).toContainText("Stacks that can move"); // the list of stacks is drawn at step 4
  await expect(page.locator("#move-undo")).toHaveCount(0);
  await expect(page.getByText(/Planes at \d+ bases?/)).toHaveCount(0); // no air moves at step 4
  // Choosing a stack outlines yellow hexes (only the minor's own stacks can be chosen at this step).
  await page.evaluate(() => window.scrollTo(0, 0));
  let chosen = false;
  for (const pt of await visibleCentres(page, "g.units > g")) {
    await tapAt(page, hasTouch, pt);
    if ((await page.locator("g.highlights polygon").count()) > 0) { chosen = true; break; }
  }
  expect(chosen, "a stack of Belgium can be chosen at step 4").toBe(true);
  await expect(page.locator(".movecard #move-cancel")).toBeVisible(); // the Move card (tick lines, Cancel) is drawn at step 4
  await expect(page.locator(".movecard .move-lines")).not.toHaveCount(0);
  await expect(page.locator("#move-undo")).toHaveCount(0); // Take back last move is step 6f's
  const dest = (await visibleCentres(page, "g.highlights polygon"))[0];
  if (!dest) throw new Error("no yellow hex is visible");
  await tapAt(page, hasTouch, dest);
  await expect(page.locator(".log li").filter({ hasText: / move from .+ to .+\.$/ })).not.toHaveCount(0);
  // A human can always pass: the step button moves on to the controller's own turn.
  await page.getByRole("button", { name: "Done with step 4" }).first().click();
  await expect(page.locator(".turn")).not.toContainText("step 4");
  expect(errors).toEqual([]);
});

test("step 4: a tap on a red hex opens the attack while the minor can still move", async ({ page, hasTouch }) => {
  test.setTimeout(120_000);
  const errors = await load(page);
  await expect(page.locator(".movelist")).toBeVisible(); // moves are still on offer
  await expect(page.locator("g.attack-marks .mk-target")).not.toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const target = (await visibleCentres(page, "g.attack-marks .mk-target"))[0];
  if (!target) throw new Error("no red hex is visible");
  await tapAt(page, hasTouch, target);
  await expect(page.locator(".attackcard")).toBeVisible();
  await expect(page.locator("#maptoast")).not.toContainText("Tap one of your stacks");
  expect(errors).toEqual([]);
});
