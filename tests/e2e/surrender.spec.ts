import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Russia's offer to surrender on the screen (spec 14, tickets 14-15 and 14-16) in a real browser, with a mouse and with a finger, at phone and iPad sizes. Two recorded games
 * (tests/e2e/fixtures/surrender-question.json and surrender-build.json, written by scripts/make-e2e-fixture.ts, loaded with the `?e2e` hook):
 * - the question: a 1939 game cut where Russia offers to surrender at the end of the Allied Player Turn of Summer 1942, so the game stands at step 10a with the Axis asked;
 *   a human Axis player reads the card and answers; a human Allied player is not asked, the computer answers;
 * - the build: a 1939 game cut at step 8b of an Allied Player Turn of Summer 1941 with the offer on its way; a human Allied player reads the construction warning, builds a
 *   Russian unit and watches the number fall; a human Axis player sees no warning.
 * A watched game (two computers) shows neither the card nor the warning.
 */

type Fixture = { scenario: string; seed: number; actions: unknown[]; shortfall?: number };
const QUESTION = JSON.parse(readFileSync("tests/e2e/fixtures/surrender-question.json", "utf8")) as Fixture;
const BUILD = JSON.parse(readFileSync("tests/e2e/fixtures/surrender-build.json", "utf8")) as Fixture;
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

/** A tap on a touch screen, a click with a mouse. */
const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click());

/** The game one action before the offer: the computer, playing the Allies, ends step 9a itself and the offer arrives on the screen as it does in play (the card scrolls into view then, which a loaded position does not do). */
const JUST_BEFORE: Fixture = { ...QUESTION, actions: QUESTION.actions.slice(0, -1) };

for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: a human Axis player is asked: the card shows the sums and both consequences, the heading has the focus, the answers are touch targets`, async ({ page }) => {
    const errors = await load(page, JUST_BEFORE, "axis", size);
    const card = page.locator("#surrender-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".turn")).toContainText("step 10a (Possible Russian surrender): Russia offers to surrender: the Axis accept or refuse");
    await expect(page.locator(".computer-status")).toHaveCount(0);
    await expect(page.locator("#surrender-title")).toBeFocused();
    await expect(page.locator("#surrender-title")).toHaveText("Russia offers to surrender");
    await expect(card).toContainText(/Russia has \d+ ground and air factors on the map\./);
    await expect(card).toContainText(/The Axis has \d+ inside Russia\./);
    await expect(card).toContainText("Russia offers because it has fewer than 50 and the Axis has at least 3 for every 2 of its own.");
    await expect(card).toContainText("If you accept");
    await expect(card).toContainText("Russia leaves the war. All its units are removed.");
    await expect(card).toContainText(/\d+ Objectives? count for the Allies for good, whoever holds (it|them) later\./);
    await expect(card).toContainText(/Germany receives \d+ Base Resource Points \(BRPs\) a year from Russia/);
    await expect(card).toContainText("If you refuse");
    await expect(card).toContainText("The war goes on. Russia stays in the game until its last ground or air unit inside Russia is gone.");
    await expect(card).toContainText("Russia will not offer again.");
    await expect(card).not.toContainText(/Occupation|SURRENDER_ANSWER/);
    const buttons = card.locator("button");
    await expect(buttons).toHaveText(["Accept Russia's surrender", "Refuse Russia's surrender"]);
    for (const b of await buttons.all()) {
      await expect(b).toBeInViewport();
      expect((await b.boundingBox())!.height, "a touch target").toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator(".actions button", { hasText: /Done with step|End .* turn|Surrender/ })).toHaveCount(0); // nothing else, moving on included
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size[0] + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(size[0]);
    expect(errors).toEqual([]);
  });
}

test("'Accept' accepts: the card goes, Russia leaves, the log says so, the nation reads Conquered, the Objectives card marks the credited ones, the game goes to step 10b", async ({ page, hasTouch }) => {
  const errors = await load(page, QUESTION, "axis");
  const credited = Number(/(\d+) Objectives? count/.exec(await page.locator("#surrender-card").innerText())![1]);
  await press(page.locator("#surrender-card button", { hasText: "Accept Russia's surrender" }), hasTouch);
  await expect(page.locator("#surrender-card")).toHaveCount(0);
  await expect(page.locator(".turn")).toContainText("step 10b");
  await expect(page.locator("ol.log li", { hasText: "The Axis accept Russia's surrender: Russia leaves the war." })).toHaveCount(1);
  await expect(page.locator("main table tbody tr", { hasText: "Soviet Union" })).toContainText("Conquered");
  await press(page.locator("#obj-open"), hasTouch);
  const marked = page.locator("#obj-card button.obj-row .obj-credited");
  await expect(marked).toHaveCount(credited);
  await expect(marked.first()).toHaveText("Credited to the Allies for good");
  await expect(page.locator("#obj-card button.obj-row", { has: page.locator(".obj-credited") }).first()).toContainText("Allies");
  expect(errors).toEqual([]);
});

test("'Refuse' refuses: the card goes, nothing is removed, the log says so, no Objective is marked, the game goes to step 10b", async ({ page, hasTouch }) => {
  const errors = await load(page, QUESTION, "axis");
  await press(page.locator("#surrender-card button", { hasText: "Refuse Russia's surrender" }), hasTouch);
  await expect(page.locator("#surrender-card")).toHaveCount(0);
  await expect(page.locator(".turn")).toContainText("step 10b");
  await expect(page.locator("ol.log li", { hasText: /^The Axis refuse Russia's surrender/ })).toHaveCount(1);
  await expect(page.locator("main table tbody tr", { hasText: "Soviet Union" })).not.toContainText("Conquered");
  await press(page.locator("#obj-open"), hasTouch);
  await expect(page.locator("#obj-card button.obj-row")).toHaveCount(42);
  await expect(page.locator("#obj-card .obj-credited")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const size of [[390, 844], [1180, 820]] as const) {
  test(`${size[0]}x${size[1]}: a human Allied player is not asked: no card, the computer, playing the Axis, answers, the log shows its reason, the game goes on`, async ({ page }) => {
    const errors = await load(page, QUESTION, "allies", size);
    await expect(page.locator("ol.log li", { hasText: /^Computer \(Axis\): The Axis accept Russia's offer to surrender/ })).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator("#surrender-card")).toHaveCount(0);
    await expect(page.locator(".turn")).not.toContainText("step 10a");
    await expect(page.locator("button", { hasText: "Accept Russia's surrender" })).toHaveCount(0);
    await expect(page.locator("main table tbody tr", { hasText: "Soviet Union" })).toContainText("Conquered");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(size[0]);
    expect(errors).toEqual([]);
  });
}

for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: a human Allied player at step 8b reads the warning under the build list; building a Russian unit lowers the number`, async ({ page, hasTouch }) => {
    const errors = await load(page, BUILD, "allies", size);
    await expect(page.locator(".turn")).toContainText("step 8b");
    const warning = page.locator(".build .surrender-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toHaveText(`Russia will offer to surrender at the end of this turn unless it has ${BUILD.shortfall!} more ground or air factors on the map. Build Russian ground or air units to stop it.`);
    const box = (await warning.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size[0] + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(size[0]);
    const chips = await page.locator(".build .chips").boundingBox();
    expect(box.y, "under the build list").toBeGreaterThan(chips!.y + chips!.height - 1);

    // Build a Russian unit: the chip, then a yellow hex of the map.
    await press(page.locator('button[data-build^="ussr:"]').first(), hasTouch);
    await page.locator("#map").scrollIntoViewIfNeeded();
    const pt = await page.locator("svg.map").evaluate((svg) => {
      const frame = svg.getBoundingClientRect();
      for (const h of svg.querySelectorAll("g.highlights polygon")) {
        const r = h.getBoundingClientRect();
        if (r.left > Math.max(frame.left, 0) + 8 && r.right < Math.min(frame.right, window.innerWidth) - 8 && r.top > Math.max(frame.top, 0) + 8 && r.bottom < Math.min(frame.bottom, window.innerHeight) - 8) return [r.left + r.width / 2, r.top + r.height / 2];
      }
      return null;
    });
    if (!pt) throw new Error("no yellow hex is visible on the map");
    if (hasTouch) await page.touchscreen.tap(pt[0]!, pt[1]!);
    else await page.mouse.click(pt[0]!, pt[1]!);
    await expect(page.locator("ol.log li").first()).toContainText("Soviet Union builds");
    await expect(page.locator(".toast")).toBeEmpty();
    const now = await page.locator(".build .surrender-warning").allInnerTexts();
    if (now.length > 0) expect(Number(/has (\d+) more/.exec(now[0]!)![1])).toBeLessThan(BUILD.shortfall!);
    expect(errors).toEqual([]);
  });
}

test("a human Axis player has no warning: the computer builds for the Allies", async ({ page }) => {
  const errors = await load(page, BUILD, "axis");
  await expect(page.locator(".surrender-warning")).toHaveCount(0);
  await expect(page.locator("#surrender-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a watched game (two computers) never draws the card or the warning, answers the offer, and goes on", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    (window as unknown as { seen: string[] }).seen = [];
    new MutationObserver(() => {
      const w = window as unknown as { seen: string[] };
      if (document.querySelector("#surrender-card, .surrender-warning") && !w.seen.includes("drawn")) w.seen.push("drawn");
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("watch");
  await page.locator("#seed").fill("4"); // the game of the fixture: Russia offers in Summer 1942
  await page.locator("#newgame").click();
  await expect(page.locator("#watchbar")).toBeVisible();
  await page.locator("#w-speed").selectOption("turbo");
  await expect(page.locator("ol.log li", { hasText: /^Russia offers to surrender: it has \d+ ground and air factors/ })).toHaveCount(1, { timeout: 150_000 });
  await expect(page.locator("ol.log li", { hasText: /^Computer \(Axis\): The Axis accept Russia's offer to surrender/ })).toHaveCount(1, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen), "no card and no warning in a watched game").toEqual([]);
  expect(errors).toEqual([]);
});
