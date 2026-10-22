import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The Russian winter on the screen (spec 14, ticket 14-13; part D4) in a real browser, with a mouse and with a finger, at phone and iPad sizes. Two recorded games
 * (tests/e2e/fixtures/winter-question.json and winter-started.json, written by scripts/make-e2e-fixture.ts, loaded with the `?e2e` hook):
 * - the question: the Allies are asked at II.A; the card shows the dice, the count and the test, the heading has the focus, and the two answers are real buttons;
 * - the told winter: the dice leave no choice; the card says so once ("OK"), the banner stays all Game Turn, and at step 3 the Axis Offensive button of the East is
 *   greyed and a tap says why.
 */

type Fixture = { scenario: string; seed: number; actions: unknown[] };
const QUESTION = JSON.parse(readFileSync("tests/e2e/fixtures/winter-question.json", "utf8")) as Fixture;
const STARTED = JSON.parse(readFileSync("tests/e2e/fixtures/winter-started.json", "utf8")) as Fixture;
type Size = readonly [number, number];
const SIZES: readonly Size[] = [[390, 844], [768, 1024], [1024, 768], [1180, 820]];

async function load(page: Page, f: Fixture, side: "axis" | "allies", size?: Size): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: f.scenario, side, seed: f.seed, actions: f.actions });
  return errors;
}

const BANNER = "Russian winter this turn. In Russia the Axis defence is not doubled. The Axis may not use an Offensive Option in the East.";

for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: the question card shows the dice, the count and the test, with the heading in focus and two buttons that are touch targets`, async ({ page }) => {
    const errors = await load(page, QUESTION, "allies", size);
    const card = page.locator("#winter-card");
    await expect(card).toBeVisible();
    await expect(page.locator(".turn")).toContainText("step II.A (Russian winter): the Allies say whether it waits");
    await expect(page.locator("#winter-title")).toBeFocused();
    await expect(page.locator("#winter-title")).toHaveText("Russian winter");
    await expect(card).toContainText("This is the first winter of the war between Germany and Russia.");
    await expect(card).toContainText(/Dice: \d \+ \d \+ \d \+ \d = \d+/);
    await expect(card).toContainText(/Axis ground units inside Russia: \d+ \(not counting Finns\)\./);
    await expect(card).toContainText(/\d+ is fewer than \d+, so Russia may wait one year\./);
    await expect(page.locator(".winter-banner")).toHaveCount(0); // the winter is not on yet
    const buttons = card.locator("button");
    await expect(buttons).toHaveText(["Wait for next winter", "Winter starts now"]);
    for (const b of await buttons.all()) {
      await expect(b).toBeInViewport();
      expect((await b.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(44);
    }
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size[0] + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(size[0]);
    expect(errors).toEqual([]);
  });
}

test("'Winter starts now' starts it: the card goes, the banner is on the turn line for the Game Turn, and the game goes on", async ({ page }) => {
  const errors = await load(page, QUESTION, "allies");
  await page.locator("#winter-card button", { hasText: "Winter starts now" }).click();
  await expect(page.locator("#winter-card")).toHaveCount(0);
  await expect(page.locator(".winter-banner")).toHaveText(BANNER);
  await expect(page.locator(".turn")).not.toContainText("step II.A");
  await expect(page.locator("ol.log li", { hasText: /^The Russian winter starts in Winter/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("'Wait for next winter' puts it off: the card goes, no banner, and the log says so", async ({ page }) => {
  const errors = await load(page, QUESTION, "allies");
  await page.locator("#winter-card button", { hasText: "Wait for next winter" }).click();
  await expect(page.locator("#winter-card")).toHaveCount(0);
  await expect(page.locator(".winter-banner")).toHaveCount(0);
  await expect(page.locator("ol.log li", { hasText: "The Allies put the Russian winter off" })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a human Axis player is not asked: the computer, playing the Allies, answers and the game goes on", async ({ page }) => {
  const errors = await load(page, QUESTION, "axis");
  await expect(page.locator("#winter-card")).toHaveCount(0);
  await expect(page.locator("ol.log li", { hasText: /^The Allies put the Russian winter off/ })).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator("ol.log li", { hasText: /^Computer \(Allied\): The dice allow it/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a winter that starts with no question: the card tells it once with an OK button, and the banner stays", async ({ page }) => {
  const errors = await load(page, STARTED, "axis");
  const card = page.locator("#winter-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-kind", "info");
  await expect(card).toContainText(/\d+ is not fewer than \d+, so Russia may not wait\./);
  await expect(page.locator(".winter-banner")).toHaveText(BANNER);
  const ok = page.locator("#winter-ok");
  await expect(ok).toHaveText("OK, the winter starts now");
  expect((await ok.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(44);
  await ok.click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".winter-banner")).toHaveText(BANNER);
  expect(errors).toEqual([]);
});

for (const size of [[390, 844], [768, 1024]] as const) {
  test(`${size[0]}x${size[1]}: at step 3 the Eastern Offensive button is greyed, a tap says why, and the other choices work`, async ({ page }) => {
    const errors = await load(page, STARTED, "axis", size);
    await page.locator("#winter-ok").click();
    // step 1 (declarations): the last button moves the game on
    await expect(page.locator(".turn")).toContainText("step 1");
    await page.locator(".actions button", { hasText: "Done with step 1" }).click();
    await expect(page.locator(".turn")).toContainText("step 3");
    const fold = page.locator("details.declarations", { hasText: "Choose a Front Option" });
    await fold.locator("summary").click();
    const grey = fold.locator("button.greyed");
    await expect(grey).toHaveText("Eastern Front: Offensive Option");
    await expect(grey).toHaveAttribute("aria-disabled", "true");
    expect((await grey.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(44);
    await expect(fold.locator("button", { hasText: "Eastern Front: Attrition Option" })).toBeVisible();
    await expect(fold.locator("button", { hasText: "Western Front: Offensive Option" })).toBeVisible();
    await grey.click({ force: true }); // aria-disabled, not disabled: Playwright waits for "enabled" otherwise, but a finger can tap it
    await expect(page.locator("p.toast")).toContainText("Russian winter: the Axis may not take the Offensive Option on the Eastern Front this Game Turn.");
    await expect(page.locator("#maptoast")).toContainText("Russian winter");
    await expect(page.locator(".turn")).toContainText("step 3"); // nothing was done
    await fold.locator("button", { hasText: "Eastern Front: Attrition Option" }).click();
    await expect(page.locator("ol.log li", { hasText: "choose the Attrition Option on the Eastern Front" })).toHaveCount(1);
    await expect(fold.locator("button.greyed")).toHaveCount(0); // the East has its Option
    expect(errors).toEqual([]);
  });
}
