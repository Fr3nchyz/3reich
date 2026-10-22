import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Russia's offer to surrender on the screen (spec 14, ticket 14-15) in a real browser, with a mouse and with a finger. One recorded game
 * (tests/e2e/fixtures/surrender-question.json, written by scripts/make-e2e-fixture.ts, loaded with the `?e2e` hook): a 1939 game of the computer cut where Russia
 * offers to surrender at the end of the Allied Player Turn of Summer 1942, so the game stands at step 10a with the Axis asked. The offer card and the construction warning
 * are ticket 14-16: here the two answers are plain buttons with words, the turn line says what is asked, and a computer playing the Axis answers by itself.
 */

type Fixture = { scenario: string; seed: number; actions: unknown[] };
const QUESTION = JSON.parse(readFileSync("tests/e2e/fixtures/surrender-question.json", "utf8")) as Fixture;
type Size = readonly [number, number];

async function load(page: Page, side: "axis" | "allies", size?: Size): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: QUESTION.scenario, side, seed: QUESTION.seed, actions: QUESTION.actions });
  return errors;
}

for (const size of [[390, 844], [1024, 768]] as const) {
  test(`${size[0]}x${size[1]}: a human Axis player is asked: the turn line says so and the two answers are touch targets in words`, async ({ page }) => {
    const errors = await load(page, "axis", size);
    await expect(page.locator(".turn")).toContainText("step 10a (Possible Russian surrender): Russia offers to surrender: the Axis accept or refuse");
    await expect(page.locator(".computer-status")).toHaveCount(0);
    await expect(page.locator("ol.log li", { hasText: /^Russia offers to surrender: it has \d+ ground and air factors on the map, and the Axis has \d+ inside Russia/ })).toHaveCount(1);
    const accept = page.locator(".actions button", { hasText: "Accept Russia's surrender" });
    const refuse = page.locator(".actions button", { hasText: "Refuse Russia's surrender" });
    await expect(accept).toBeVisible();
    await expect(refuse).toBeVisible();
    for (const b of [accept, refuse]) {
      await b.scrollIntoViewIfNeeded(); // like every step button, they sit below the map and the nation table; the card that brings them up is ticket 14-16
      await expect(b).toBeInViewport();
      expect((await b.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator(".actions button", { hasText: /Done with step|End .* turn/ })).toHaveCount(0); // nothing else, moving on included
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(size[0]);
    expect(await page.locator("main").innerText()).not.toContain("SURRENDER_ANSWER");
    expect(errors).toEqual([]);
  });
}

test("'Accept' accepts: Russia leaves, the log says so, the Russian nation reads Conquered and the game goes on to step 10b", async ({ page }) => {
  const errors = await load(page, "axis");
  await page.locator(".actions button", { hasText: "Accept Russia's surrender" }).click();
  await expect(page.locator(".turn")).toContainText("step 10b");
  await expect(page.locator("ol.log li", { hasText: "The Axis accept Russia's surrender: Russia leaves the war." })).toHaveCount(1);
  await expect(page.locator("ol.log li", { hasText: /objectives? now counts? for the Allies for good/ })).toHaveCount(1);
  await expect(page.locator("main table tbody tr", { hasText: "Soviet Union" })).toContainText("Conquered");
  await expect(page.locator(".actions button", { hasText: "Accept Russia's surrender" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("'Refuse' refuses: nothing is removed, the log says so, and the game goes on to step 10b", async ({ page }) => {
  const errors = await load(page, "axis");
  await page.locator(".actions button", { hasText: "Refuse Russia's surrender" }).click();
  await expect(page.locator(".turn")).toContainText("step 10b");
  await expect(page.locator("ol.log li", { hasText: /^The Axis refuse Russia's surrender/ })).toHaveCount(1);
  await expect(page.locator("main table tbody tr", { hasText: "Soviet Union" })).not.toContainText("Conquered");
  expect(errors).toEqual([]);
});

test("a human Allied player is not asked: the computer, playing the Axis, answers, the log shows its reason, and the game goes on", async ({ page }) => {
  const errors = await load(page, "allies");
  await expect(page.locator("ol.log li", { hasText: /^Computer \(Axis\): The Axis accept Russia's offer to surrender/ })).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator(".turn")).not.toContainText("step 10a");
  await expect(page.locator(".actions button", { hasText: "Accept Russia's surrender" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
