import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Choosing which units of a stack move (spec 10, tickets 10-3 and 10-4) in a real browser, with a mouse and with a finger. The game is loaded at
 * step 6f of the first Axis Player Turn: the recorded game of tests/e2e/fixtures/axis-at-7h.json up to its first MOVE (the `?e2e` test hook,
 * src/ui/e2eLoad.ts). There J36 holds a 4-6 armor and a 3-3 infantry (the pair goes 3 hexes, the armor alone further), O32 two 4-6 armor.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: { type: string }[] };
const TO_6F = FIXTURE.actions.slice(0, FIXTURE.actions.findIndex((a) => a.type === "MOVE"));

async function load(page: Page, size?: Pt): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed: FIXTURE.seed, actions: TO_6F });
  await expect(page.locator(".turn")).toContainText("step 6f");
  return errors;
}

async function tapAt(page: Page, touch: boolean, pt: Pt): Promise<void> {
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}
/** Presses a button the way the project does: a tap with a finger, a click with a mouse. */
const press = (loc: Locator, touch: boolean, force = false) => (touch ? loc.tap({ force }) : loc.click({ force }));

async function centreOf(page: Page, id: string): Promise<Pt> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
}
const tapHexId = async (page: Page, touch: boolean, id: string) => tapAt(page, touch, await centreOf(page, id));

const card = (page: Page) => page.locator(".movecard");
const lines = (page: Page) => page.locator("button.mline");
const yellow = (page: Page) => page.locator("g.highlights polygon:not(.further)");
const further = (page: Page) => page.locator("g.highlights polygon.further");
const moveLog = (page: Page) => page.locator(".log li").filter({ hasText: / move from / });

/** The stacks that can move, from the list (the hexes a tap on the map must not hit by mistake when it means a destination). */
const stackHexes = (page: Page) => page.locator("button.stack-row").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.stack!));

/** The id of a yellow hex with no stack of ours on it, and where to tap it. */
async function emptyYellow(page: Page, avoid: readonly string[]): Promise<{ id: string; pt: Pt }> {
  const found = await page.locator("svg.map").evaluate((svg, skip) => {
    const box = svg.getBoundingClientRect();
    for (const h of svg.querySelectorAll("g.highlights polygon:not(.further)")) {
      const id = h.getAttribute("data-hl")!;
      const r = h.getBoundingClientRect();
      if (skip.includes(id) || r.left < Math.max(box.left, 0) + 8 || r.right > Math.min(box.right, window.innerWidth) - 8 || r.top < Math.max(box.top, 0) + 8 || r.bottom > Math.min(box.bottom, window.innerHeight) - 8) continue;
      return { id, pt: [r.left + r.width / 2, r.top + r.height / 2] as const };
    }
    return null;
  }, avoid);
  if (!found) throw new Error("no yellow hex is visible");
  return found;
}

test("tap a stack, untick one unit, tap a yellow hex: only the ticked unit moves, the other stays and the hex stays chosen", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await expect(page.locator("#stacks-title")).toHaveText("Stacks that can move (6)");
  await expect(page.locator(".nextbar")).toContainText("Next: tap a stack of yours to move, or finish step 6f.");
  const stacks = await stackHexes(page);
  await tapHexId(page, hasTouch, "J36");
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("h2")).toHaveText(/^Move from .*J36\)$/);
  await expect(card(page).locator("h2")).toBeFocused();
  await expect(lines(page)).toHaveCount(2);
  await expect(card(page).locator('button.mline[aria-pressed="true"]')).toHaveCount(2);
  await expect(card(page)).toContainText("2 of 2 ticked.");
  await expect(card(page)).toContainText("Together they can go up to 3 hexes (set by the 3-3 German infantry).");
  await expect(card(page)).toContainText("The 4-6 German armor alone could go up to 6 hexes. Untick the 3-3 German infantry to let it go further.");
  await expect(page.locator("#stacks-title")).toHaveCount(0);
  const together = await yellow(page).count();
  expect(together).toBeGreaterThan(0);
  await expect(further(page)).not.toHaveCount(0);

  await press(lines(page).filter({ hasText: "infantry" }), hasTouch);
  await expect(card(page).locator('button.mline[aria-pressed="false"]')).toHaveCount(1);
  await expect(card(page)).toContainText("1 of 2 ticked.");
  await expect(card(page)).toContainText(/Staying in .*J36\): 3-3 German infantry\./);
  expect(await yellow(page).count(), "the armor alone reaches more hexes").toBeGreaterThan(together);
  await expect(page.locator(".nextbar")).toContainText("Next: tap a yellow hex to move the unit, or cancel.");

  const dest = await emptyYellow(page, stacks);
  await tapAt(page, hasTouch, dest.pt);
  await expect(moveLog(page).first()).toHaveText(new RegExp(`^4-6 German armor move from .*J36\\) to .*${dest.id}`));
  await expect(page.locator("#maptoast")).toContainText(/Staying in .*J36\): 3-3 German infantry\./);
  await expect(card(page).locator("h2")).toHaveText(/^Move from .*J36\)$/);
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page).first()).toContainText("infantry");
  await expect(lines(page).first()).toHaveAttribute("aria-pressed", "true");
  expect(await yellow(page).count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("the old two taps still move a whole stack; the card is gone afterwards and the list is back", async ({ page, hasTouch }) => {
  await load(page);
  const stacks = await stackHexes(page);
  await tapHexId(page, hasTouch, "O32");
  await expect(card(page).locator("h2")).toHaveText(/^Move from .*O32\)$/);
  await expect(lines(page)).toHaveCount(2);
  const dest = await emptyYellow(page, stacks);
  await tapAt(page, hasTouch, dest.pt);
  await expect(moveLog(page).first()).toHaveText(new RegExp(`^2 x 4-6 German armor move from .*O32\\) to .*${dest.id}`));
  await expect(card(page)).toHaveCount(0);
  await expect(yellow(page)).toHaveCount(0);
  await expect(page.locator("#stacks-title")).toHaveText("Stacks that can move (5)");
});

test("None leaves no yellow hex and says to tick; All brings the ticks back", async ({ page, hasTouch }) => {
  await load(page);
  await tapHexId(page, hasTouch, "J36");
  await press(page.locator("#move-none"), hasTouch);
  await expect(yellow(page)).toHaveCount(0);
  await expect(card(page)).toContainText("0 of 2 ticked.");
  await expect(card(page)).toContainText("Tick at least one unit.");
  await press(page.locator("#move-all"), hasTouch);
  await expect(card(page).locator('button.mline[aria-pressed="true"]')).toHaveCount(2);
  expect(await yellow(page).count()).toBeGreaterThan(0);
});

test("Cancel, Escape and a second tap on the hex each drop the choice and move nothing", async ({ page, hasTouch }) => {
  await load(page);
  await tapHexId(page, hasTouch, "J36");
  await press(page.locator("#move-cancel"), hasTouch);
  await expect(card(page)).toHaveCount(0);
  await expect(yellow(page)).toHaveCount(0);

  await tapHexId(page, hasTouch, "J36");
  await expect(card(page).locator("h2")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(yellow(page)).toHaveCount(0);

  await tapHexId(page, hasTouch, "J36");
  await expect(card(page)).toBeVisible();
  await tapHexId(page, hasTouch, "J36");
  await expect(card(page)).toHaveCount(0);
  await expect(moveLog(page)).toHaveCount(0);
});

test("the list: a row chooses the stack and opens the same card; a second press on the row (the card's Cancel) lets it go", async ({ page, hasTouch }) => {
  await load(page);
  await press(page.locator('button.stack-row[data-stack="J36"]'), hasTouch);
  await expect(card(page).locator("h2")).toHaveText(/^Move from .*J36\)$/);
  await expect(card(page).locator("h2")).toBeFocused();
  await expect(lines(page)).toHaveCount(2);
  expect(await yellow(page).count()).toBeGreaterThan(0);
  await press(page.locator("#move-cancel"), hasTouch);
  await expect(page.locator('button.stack-row[data-stack="J36"]')).toBeVisible();
});

test("a counter that cannot move on the ground is greyed with the reason and cannot be ticked", async ({ page, hasTouch }) => {
  await load(page);
  await press(page.locator('button.stack-row[data-stack="L31"]'), hasTouch);
  const air = lines(page).filter({ hasText: "air" });
  await expect(air).toHaveAttribute("aria-disabled", "true");
  await expect(air).toContainText("does not move on the ground");
  await expect(card(page).locator("h3")).toHaveText(["Ground", "Air"]);
  await press(air, hasTouch, true); // aria-disabled: Playwright would wait for it to be enabled
  await expect(card(page)).toContainText("2 of 2 ticked.");
});

test("no raw unit id is shown anywhere in the card or the list", async ({ page }) => {
  await load(page);
  const listText = (await page.locator(".moves").innerText()) + (await page.locator(".nextbar").innerText());
  expect(listText).not.toMatch(/\bu\d+\b/);
  await page.locator('button.stack-row[data-stack="J36"]').click();
  expect((await page.locator(".moves").innerText()) + (await page.locator("#maptoast").innerText())).not.toMatch(/\bu\d+\b/);
});

test("watch mode: taps only inspect; no list and no card", async ({ page, hasTouch }) => {
  await page.goto("/");
  await page.locator("#side").selectOption("watch");
  await page.locator("#seed").fill("4242");
  await page.locator("#newgame").click();
  await expect(page.locator(".turn")).toContainText("player turn");
  await tapHexId(page, hasTouch, "M35");
  await expect(page.locator(".hexcard")).toBeVisible();
  await expect(page.locator(".moves")).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
});

const SIZES: readonly Pt[] = [[1024, 768], [1180, 820], [768, 1024], [390, 844]];
for (const size of SIZES) {
  test(`${size[0]}x${size[1]}: the Next bar and the card's buttons stay in reach, every button is 44 px, the map stays on screen, nothing scrolls sideways`, async ({ page, hasTouch }) => {
    await load(page, size);
    const bar = page.locator(".nextbar");
    await expect(bar).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#stacks-title"), "the list is on screen when step 6f begins").toBeInViewport();
    for (const b of await page.locator(".nextbar button:visible, .movelist button:visible").all()) {
      const box = (await b.boundingBox())!;
      expect(box.height, "list button tall enough").toBeGreaterThanOrEqual(44);
      expect(box.width, "list button wide enough").toBeGreaterThanOrEqual(44);
    }
    await press(page.locator('button.stack-row[data-stack="J36"]'), hasTouch);
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator("h2")).toBeFocused();
    await expect(bar, "the Next bar with its button is on screen with the card open").toBeInViewport({ ratio: 1 });
    for (const sel of ["#move-cancel", "#move-all", "#move-none"]) await expect(page.locator(sel), `${sel} is in reach`).toBeInViewport({ ratio: 1 });
    await expect(lines(page).first(), "the first unit line is in reach").toBeInViewport({ ratio: 1 });
    const barBox = (await bar.boundingBox())!;
    const cardTop = (await card(page).boundingBox())!.y;
    expect(barBox.y + barBox.height, "the Next bar does not cover the card").toBeLessThanOrEqual(cardTop + 1);
    const map = (await page.locator(".map-wrap").boundingBox())!;
    expect(map.height, "the map is still on screen").toBeGreaterThan(size[1] * 0.25);
    expect(map.y + map.height).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size[0]);
    for (const b of await page.locator(".nextbar button:visible, .movecard button:visible").all()) {
      const box = (await b.boundingBox())!;
      const name = (await b.innerText()).slice(0, 30).replace(/\n/g, " ");
      expect(box.height, `${name} is tall enough`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${name} is wide enough`).toBeGreaterThanOrEqual(44);
    }
    const boxes = await page.locator(".movecard button.mline, .movecard .move-tools button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    for (let i = 1; i < boxes.length; i++) {
      const a = boxes[i - 1]!, b = boxes[i]!;
      const gap = Math.max(b.left - a.right, b.top - a.bottom, a.left - b.right, a.top - b.bottom);
      expect(gap, "buttons do not touch").toBeGreaterThanOrEqual(8);
    }
    await page.screenshot({ path: `test-results/move-${size[0]}x${size[1]}.png` });
  });
}

/** The screen point of a hex without moving the page (the map is pinned or in its own column, so a finger never needs the page scrolled). */
const here = (page: Page, id: string): Promise<Pt> =>
  page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });

/** The card's heading, Cancel, All and None are on screen and the sticky Next bar does not cover them. */
async function cardInReach(page: Page, what: string): Promise<void> {
  for (const sel of ["#move-title", "#move-cancel", "#move-all", "#move-none"]) await expect(page.locator(sel), `${what}: ${sel} is in view`).toBeInViewport({ ratio: 1 });
  const bar = (await page.locator(".nextbar").boundingBox())!;
  const head = (await page.locator("#move-title").boundingBox())!;
  expect(bar.y + bar.height, `${what}: the Next bar does not cover the card heading`).toBeLessThanOrEqual(head.y + 1);
  await expect(page.locator(".nextbar"), `${what}: the Next bar is in view`).toBeInViewport({ ratio: 1 });
}

for (const size of [[390, 844], [1024, 768], [1180, 820]] as const) {
  test(`${size[0]}x${size[1]}: the card stays where it is after a partial move, a refused tap and a tap on the second shade; Escape still cancels`, async ({ page, hasTouch }) => {
    await load(page, size);
    const stacks = await stackHexes(page);
    await tapAt(page, hasTouch, await here(page, "J36"));
    await expect(card(page)).toBeVisible();
    await cardInReach(page, "opened");
    const top = await page.evaluate(() => window.scrollY);

    // A tap on an enemy hex is refused; the page does not move.
    await tapAt(page, hasTouch, await here(page, "M35"));
    await expect(page.locator("#maptoast")).toContainText("cannot get there");
    await cardInReach(page, "after a refused tap");
    expect(await page.evaluate(() => window.scrollY)).toBe(top);

    // Untick the infantry; the armor's own reach beyond the group is the second shade: a tap on it moves nothing.
    await press(lines(page).filter({ hasText: "infantry" }), hasTouch);
    await page.evaluate((y) => window.scrollTo(0, y), top); // Playwright scrolls a line into view on a phone; a person's page stays where it was
    await tapAt(page, hasTouch, await here(page, "M35"));
    await cardInReach(page, "after unticking and a refused tap");
    expect(await page.evaluate(() => window.scrollY)).toBe(top);

    // Partial move: the armor goes, the infantry stays; the card is still there and in reach.
    const dest = await emptyYellow(page, stacks);
    await tapAt(page, hasTouch, dest.pt);
    await expect(moveLog(page).first()).toBeVisible();
    await expect(lines(page)).toHaveCount(1);
    await cardInReach(page, "after a partial move");
    expect(await page.evaluate(() => window.scrollY)).toBe(top);

    // Escape cancels even though the focus is not in the card (a tap on the map took it).
    await tapAt(page, hasTouch, await here(page, "M35"));
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
  });
}

test("a toast from a refused tap is gone after All, None or Cancel", async ({ page, hasTouch }) => {
  await load(page);
  await tapHexId(page, hasTouch, "J36");
  await press(page.locator("#move-none"), hasTouch);
  await tapHexId(page, hasTouch, "M35");
  await expect(page.locator("#maptoast")).toHaveText("Tick at least one unit.");
  await press(page.locator("#move-all"), hasTouch);
  await expect(page.locator("#maptoast")).toHaveText("");
  await expect(page.locator(".toast")).toHaveText("");
  await press(page.locator("#move-none"), hasTouch);
  await tapHexId(page, hasTouch, "M35");
  await press(page.locator("#move-cancel"), hasTouch);
  await expect(page.locator("#maptoast")).toHaveText("");
  await expect(page.locator(".toast")).toHaveText("");
});

/** A real game of 1939 as Axis, played to step 6f the way a person does (steps 1 and 3 by their buttons). */
async function arriveAt6f(page: Page, size: Pt): Promise<void> {
  await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();
  for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();
  await expect(page.locator(".turn")).toContainText("step 1");
  await page.locator(".nextbar button[data-action], .actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 3");
  await page.locator("summary", { hasText: "Choose a Front Option" }).click();
  await page.getByRole("button", { name: "Eastern Front: Offensive Option", exact: true }).click();
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 6f");
}

for (const size of [[1024, 768], [1180, 820], [768, 1024], [390, 844]] as const) {
  test(`${size[0]}x${size[1]}: arriving at step 6f brings the Next bar and the list of stacks into view`, async ({ page }) => {
    await arriveAt6f(page, size);
    const bar = page.locator(".nextbar");
    await expect(bar).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#stacks-title")).toBeInViewport({ ratio: 1 });
    const barBox = (await bar.boundingBox())!;
    const first = (await page.locator("button.stack-row").first().boundingBox())!;
    expect(first.y, "the first row is not under the Next bar").toBeGreaterThanOrEqual(barBox.y + barBox.height);
    expect(first.y, "the first row is on screen").toBeLessThan(size[1]);
  });
}
