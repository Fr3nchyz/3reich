import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The air screens (spec 09, ticket 09-16) in a real browser at phone and iPad sizes, with a mouse and with a finger: the planes and airbases of step 6f
 * (tickets 09-13), the air-support card of step 7b and the planes on the attack card of step 7h (ticket 09-14). At every size: nothing makes the page
 * scroll sideways; every button and every fold-out heading is at least 44 px in both directions; every control can be pressed (wholly on screen and
 * nothing covering its middle) after scrolling a little at a time, the way a finger does, which is what the pinned map, the Next bar and the sticky button
 * bar of a card must not prevent; and no unit id, "undefined" or "NaN" appears in any words. The game is the recorded game of tests/e2e/fixtures/axis-at-7h.json
 * (the `?e2e` test hook, src/ui/e2eLoad.ts). Step 6f: up to its first MOVE; German 5-4 air counters stand at L31, M27, N26 and N29. Step 7b: up to the end of
 * step 6f with two planes changed to bases near Poland first (STAGE_AIR), as tests/e2e/air-support.spec.ts does.
 */

type Pt = readonly [number, number];
type Recorded = { type: string };
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: Recorded[] };
const TO_6F = FIXTURE.actions.slice(0, FIXTURE.actions.findIndex((a) => a.type === "MOVE"));
const TO_7B = [
  ...FIXTURE.actions.slice(0, FIXTURE.actions.length - 1),
  { type: "STAGE_AIR", side: "axis", units: ["u107"], to: "O32" },
  { type: "STAGE_AIR", side: "axis", units: ["u108"], to: "K33" },
  { type: "END_STEP", side: "axis", step: "6f" },
];

/** The smallest phone, a phone upright and on its side, and the iPad upright and on its side (and the large one). */
const SIZES: readonly Pt[] = [[320, 640], [390, 844], [844, 390], [768, 1024], [1024, 768], [1180, 820]];
const MIN = 44;

async function load(page: Page, size: Pt, actions: Recorded[], step: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed: FIXTURE.seed, actions });
  await expect(page.locator(".turn")).toContainText(`step ${step}`);
  return errors;
}

/** Whether a control is wholly on screen and nothing covers its middle: a finger can press it without scrolling. */
async function reachable(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth && hit !== null && (el === hit || el.contains(hit));
  });
}

/** Scrolls a little at a time, the way a finger does, until the control can be pressed; false if scrolling never gets it there. */
async function reachableAfterScroll(page: Page, loc: Locator): Promise<boolean> {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
  for (let i = 0; i < 40; i++) {
    if (await reachable(loc)) return true;
    await page.evaluate(() => { window.scrollBy(0, 40); document.getElementById("status")!.scrollTop += 40; });
  }
  return reachable(loc);
}

/** Every button and fold-out heading inside `scope` that is drawn and smaller than 44 px either way, by its words. */
async function tooSmall(scope: Locator): Promise<string[]> {
  return scope.evaluate((root, min) => {
    const found: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("button, summary")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue; // inside a closed fold-out
      if (b.height < min - 0.5 || b.width < min - 0.5) found.push(`${(el.textContent ?? "").trim().slice(0, 40)} (${Math.round(b.width)}x${Math.round(b.height)})`);
    }
    return found;
  }, MIN);
}

/** The controls of a scope, drawn ones only. */
const controls = (scope: Locator) => scope.locator("button, summary").filter({ visible: true });

async function expectAllReachable(page: Page, scope: Locator, what: string): Promise<void> {
  for (const [i, c] of (await controls(scope).all()).entries()) {
    expect(await reachableAfterScroll(page, c), `${what}: control ${i + 1} (${((await c.textContent()) ?? "").trim().slice(0, 40)}) can be pressed after scrolling`).toBe(true);
  }
}

/** The words on the page: no unit id, no "undefined", no "NaN"; and the page does not scroll sideways. */
async function expectWords(page: Page, scope: Locator, what: string): Promise<void> {
  const text = await scope.innerText();
  expect(text, `${what}: no unit id`).not.toMatch(/\bu\d+\b/);
  expect(text, `${what}: no undefined or NaN`).not.toMatch(/undefined|NaN/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${what}: no sideways scroll`).toBe(true);
}

for (const size of SIZES) {
  const [w, h] = size;

  test(`${w}x${h}: step 6f, the planes list and card and the airbases: every button 44 px, reachable, in words`, async ({ page, hasTouch }) => {
    test.setTimeout(60_000); // about 16 s on a quiet machine; a slow shared runner needs room
    const errors = await load(page, size, TO_6F, "6f");
    const press = (loc: Locator) => (hasTouch ? loc.tap() : loc.click());
    const moves = page.locator(".air-moves");
    await expect(moves.locator("#planes-title")).toHaveText("Planes at 4 bases");
    expect(await tooSmall(moves), "list").toEqual([]);
    await expectWords(page, moves, "the list");
    await expectAllReachable(page, moves, "the list");

    // The card of a base with a ground stack on it is opened from the list.
    await reachableAfterScroll(page, moves.locator("button[data-planebase]").first());
    await press(moves.locator("button[data-planebase]").first());
    const card = page.locator(".planecard");
    await expect(card).toBeVisible();
    expect(await tooSmall(card), "card").toEqual([]);
    expect(await tooSmall(page.locator(".nextbar")), "Next bar").toEqual([]);
    await expectWords(page, card, "the card");
    await expectAllReachable(page, card, "the card");
    expect(await reachableAfterScroll(page, page.locator(".nextbar button", { hasText: "Done with step 6f" })), "Done with step 6f").toBe(true);

    // The range ring toggles and the fold-out of refused bases opens, both still 44 px.
    await press(card.locator("#plane-range"));
    await expect(card.locator("#plane-range")).toHaveAttribute("aria-pressed", "true");
    const refused = card.locator("details", { hasText: "Bases they cannot use" });
    expect(await refused.count(), "the fold-out of refused bases is on the card").toBe(1);
    await press(refused.locator("summary"));
    expect(await tooSmall(card), "card with the fold-out open").toEqual([]);
    await expectWords(page, card, "the refused bases");

    // Split and join, if the engine offers them for this base.
    const split = card.locator("details", { hasText: "Split the" });
    expect(await split.count(), "the fold-out of splits is on the card").toBe(1);
    await reachableAfterScroll(page, split.locator("summary"));
    await press(split.locator("summary"));
    expect(await tooSmall(card), "card with the splits open").toEqual([]);
    await expectAllReachable(page, card, "the splits");

    await press(card.locator("#plane-cancel"));
    await expect(card).toHaveCount(0);

    // The airbases: the places are listed and every row can be pressed.
    const owner = moves.locator('button[data-airowner="germany"]');
    await reachableAfterScroll(page, owner);
    await press(owner);
    const base = page.locator(".airbasecard");
    await expect(base).toBeVisible();
    await press(base.locator("summary"));
    expect(await tooSmall(base), "airbase card").toEqual([]);
    await expectWords(page, base, "the airbase card");
    await expectAllReachable(page, base, "the airbase card");
    await press(base.locator("#airbase-cancel"));
    await expect(base).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${w}x${h}: step 7b, the air-support card: every button 44 px, the chips and the Commit button reachable, in words`, async ({ page, hasTouch }) => {
    test.setTimeout(60_000); // about 16 s on a quiet machine; a slow shared runner needs room
    const errors = await load(page, size, TO_7B, "7b");
    const press = (loc: Locator) => (hasTouch ? loc.tap() : loc.click());
    const list = page.locator(".air-support");
    await expect(list.locator("h2").first()).toHaveText("Air support you can add (2)");
    expect(await tooSmall(list), "list").toEqual([]);
    await expectWords(page, list, "the list");
    await expectAllReachable(page, list, "the list");

    await reachableAfterScroll(page, page.locator("button.air-row").first());
    await press(page.locator("button.air-row").first());
    const card = page.locator(".aircard");
    await expect(card).toBeVisible();
    expect(await tooSmall(card), "card").toEqual([]);
    await expectWords(page, card, "the card");
    await expectAllReachable(page, card, "the card");
    expect(await reachableAfterScroll(page, page.locator("#air-go")), "Commit").toBe(true);
    expect(await reachableAfterScroll(page, page.locator(".nextbar button", { hasText: "Done with step 7b" })), "Done with step 7b").toBe(true);
    await press(page.locator("#air-go"));
    await expect(card).toHaveCount(0);

    // At step 7h the attack card lists the planes that count as chips that cannot be pressed; the card's buttons are still 44 px and reachable.
    await press(page.locator(".nextbar button", { hasText: "Done with step 7b" }));
    await expect(page.locator(".turn")).toContainText("step 7h");
    await expect(page.locator(".air-warn")).toBeVisible();
    await reachableAfterScroll(page, page.locator("button.attack-row").first());
    await press(page.locator("button.attack-row").first());
    const attack = page.locator(".attackcard");
    await expect(attack).toBeVisible();
    await expect(attack.locator(".air-plane").first()).toContainText("Counts in this attack");
    expect(await tooSmall(attack), "attack card").toEqual([]);
    await expectWords(page, attack, "the attack card");
    await expectAllReachable(page, attack, "the attack card");
    expect(errors).toEqual([]);
  });
}
