import { expect, test, type Page } from "@playwright/test";

/**
 * The hex card (spec 07, part A) in a real browser, with a mouse and with a finger: tap any hex from the first Player Turn on and the card
 * lists the counters in it; it is not there during setup; it never changes a move or a build in progress; it works on an iPad both ways
 * round (two columns, and the pinned map), on a phone, while watching, and with the keyboard.
 */

type Pt = readonly [number, number];

async function tapAt(page: Page, touch: boolean, pt: Pt): Promise<void> {
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}

/** The screen point of the middle of a hex, after bringing the map to the top of the page. */
async function centreOf(page: Page, id: string): Promise<Pt> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const pt = await page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
  return pt;
}

const tapHexId = async (page: Page, touch: boolean, id: string) => tapAt(page, touch, await centreOf(page, id));

/** A 1939 game as Axis, set up, standing at step 1 of the first Player Turn. */
async function startPlay(page: Page, size?: Pt): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();
  for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();
  await expect(page.locator(".turn")).toContainText("step 1");
  return errors;
}

/** Steps 1 and 3 (Germany's free Eastern Front Offensive Option) on the way to step 6f, the way move.spec.ts goes. */
async function toMovement(page: Page): Promise<void> {
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 3");
  await page.locator("summary", { hasText: "Choose a Front Option" }).click();
  await page.getByRole("button", { name: "Eastern Front: Offensive Option", exact: true }).click();
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 6f");
}

const card = (page: Page) => page.locator(".hexcard");

test("setup: tapping a hex shows no card", async ({ page, hasTouch }) => {
  await page.goto("/");
  await page.locator("#newgame").click();
  await expect(page.locator(".setup h2")).toContainText("Your setup");
  await page.evaluate(() => window.scrollTo(0, 0));
  // The map is zoomed on Germany during setup: tap a hex where the chosen counter may go (a yellow one).
  const spot = await page.locator("g.highlights polygon").first().evaluate((p) => {
    const r = p.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  });
  await tapAt(page, hasTouch, spot);
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("#hexinfo")).not.toHaveText("Tap or hover a hex"); // the one-line info over the map stays
});

test("first Player Turn: tapping Warsaw lists the four Polish counters; an empty hex says so; Close hides the card", async ({ page, hasTouch }) => {
  const errors = await startPlay(page);
  await tapHexId(page, hasTouch, "M35");
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator("h2")).toHaveText("Warsaw (M35)");
  await expect(card(page)).toContainText("Held by Poland.");
  await expect(card(page)).toContainText("4 counters");
  const units = card(page).locator(".hexcard-units li");
  await expect(units).toHaveCount(4);
  await expect(units.filter({ hasText: "Polish infantry" })).toHaveCount(2);
  await expect(units.filter({ hasText: "Polish air" })).toHaveCount(2);
  await expect(card(page).locator(".hexcard-units li").first()).toContainText("2-3");
  expect(await card(page).innerText()).not.toMatch(/\bu\d+\b/);

  await tapHexId(page, hasTouch, "M34");
  await expect(card(page).locator("h2")).toContainText("(M34)");
  await expect(card(page)).toContainText("No counters here.");

  const close = page.locator("#hexcard-close");
  const box = (await close.boundingBox())!;
  expect(box.width, "touch target").toBeGreaterThanOrEqual(44);
  expect(box.height, "touch target").toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(card(page)).toHaveCount(0);
  await tapHexId(page, hasTouch, "M35");
  await expect(card(page).locator(".hexcard-units li")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("a German hex lists German counters with their factors", async ({ page, hasTouch }) => {
  await startPlay(page);
  const hex = await page.evaluate(() => [...document.querySelectorAll("svg.map g.units > g")].map((g) => g.getAttribute("data-at"))[0]);
  expect(hex).toBeTruthy();
  await tapHexId(page, hasTouch, hex!);
  await expect(card(page).locator(".hexcard-units li").first()).toContainText(/\d(-\d)?\s+\S+ (infantry|armor|airborne|replacement|air|fleet|airbase|bridgehead)/);
});

test("keyboard: the heading takes the focus, Tab reaches Close, Enter and Escape close the card", async ({ page, hasTouch }) => {
  await startPlay(page);
  await tapHexId(page, hasTouch, "M35");
  await expect(page.locator("#hexcard-title")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#hexcard-close")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveCount(0);

  await tapHexId(page, hasTouch, "M35");
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
});

test("step 6f: looking at an enemy hex leaves the chosen stack and its yellow hexes alone", async ({ page, hasTouch }) => {
  test.setTimeout(120_000);
  const errors = await startPlay(page);
  await toMovement(page);
  // Choose a stack: tap visible counters until one has destinations.
  const stacks = await page.locator("svg.map g.units > g").evaluateAll((gs) => gs.map((g) => g.getAttribute("data-at")!));
  let chosen: string | null = null;
  for (const id of stacks) {
    await tapHexId(page, hasTouch, id);
    if ((await page.locator("g.highlights polygon").count()) > 0) { chosen = id; break; }
  }
  expect(chosen, "a stack that can move").not.toBeNull();
  await expect(card(page).locator("h2")).not.toHaveCount(0);
  const yellow = await page.locator("g.highlights polygon").evaluateAll((ps) => ps.map((p) => p.getAttribute("data-hl")).sort());
  const log = await page.locator(".log li").count();

  await tapHexId(page, hasTouch, "M35");
  await expect(card(page).locator("h2")).toHaveText("Warsaw (M35)");
  await expect(card(page).locator(".hexcard-units li")).toHaveCount(4);
  expect(await page.locator("g.highlights polygon").evaluateAll((ps) => ps.map((p) => p.getAttribute("data-hl")).sort())).toEqual(yellow);
  expect(await page.locator(".log li").count(), "nothing was played").toBe(log);
  expect(errors).toEqual([]);
});

test("step 8b: looking at a hex leaves the chosen build chosen", async ({ page, hasTouch }) => {
  test.setTimeout(120_000);
  await startPlay(page);
  await toMovement(page);
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 8b");
  const chip = page.locator("button[data-build]").first();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const yellow = await page.locator("g.highlights polygon").count();
  expect(yellow).toBeGreaterThan(0);
  await tapHexId(page, hasTouch, "M35");
  await expect(card(page).locator("h2")).toHaveText("Warsaw (M35)");
  await expect(page.locator("button[data-build]").first()).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("g.highlights polygon").count()).toBe(yellow);
});

// iPad both ways round first, then a computer window and a phone.
const LAYOUTS = [[1024, 768, true], [1366, 1024, true], [820, 1180, false], [768, 1024, false], [1180, 820, true], [1400, 1000, true], [390, 844, false]] as const;
for (const [width, height, twoColumns] of LAYOUTS) {
  test(`${width}x${height}: the card is in the status column, in view, with the map still on screen`, async ({ page, hasTouch }) => {
    await startPlay(page, [width, height]);
    // Scroll the panels as far down as they go: the card must still come into view when a hex is tapped.
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const status = document.getElementById("status")!;
      status.scrollTop = status.scrollHeight;
    });
    const dock = (await page.locator(".map-dock").boundingBox())!;
    const spot = await page.locator('svg.map polygon[data-id="M35"]').evaluate((p) => {
      const r = p.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2] as const;
    });
    await tapAt(page, hasTouch, spot);
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toBeInViewport({ ratio: 0.99 });
    // The card sits below the step buttons.
    const lastButton = (await page.locator("main .actions button[data-action]").last().boundingBox())!;
    expect((await card(page).boundingBox())!.y, "below the step buttons").toBeGreaterThan(lastButton.y);
    const c = (await card(page).boundingBox())!;
    expect(c.y, "not hidden behind the pinned map").toBeGreaterThanOrEqual(twoColumns ? 0 : dock.y + dock.height - 1);
    if (twoColumns) expect(c.x, "in the column beside the map").toBeGreaterThanOrEqual(dock.x + dock.width - 1);
    expect(c.x + c.width, "inside the screen").toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "no sideways scroll").toBeLessThanOrEqual(width);
    expect((await page.locator("#hexcard-close").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator(".map-wrap").boundingBox())!.height, "the map is still a share of the screen").toBeGreaterThan(height * 0.3);
    await expect(page.locator("svg.map")).toBeInViewport();
  });
}

test("watching two computers: a tap fills the card, read-only", async ({ page, hasTouch }) => {
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("watch");
  await page.locator("#seed").fill("11");
  await page.locator("#newgame").click();
  await expect(page.locator("#watchbar")).toBeVisible();
  await page.locator("#w-play").click();
  await expect(page.locator("#w-play")).toHaveText("Play");
  const before = await page.locator("#w-status").innerText();
  await tapHexId(page, hasTouch, "M35");
  await expect(card(page).locator("h2")).toHaveText("Warsaw (M35)");
  await expect(card(page)).toContainText(/\d+ counters?|No counters here\./);
  expect(await page.locator("#w-status").innerText(), "looking plays nothing").toBe(before);
});

// The card never pushes the step prompt and its buttons down (iPad portrait is the main case).
for (const [width, height] of [[768, 1024], [1024, 768], [390, 844]] as const) {
  test(`${width}x${height}: opening the card leaves the step buttons where they were`, async ({ page, hasTouch }) => {
    await startPlay(page, [width, height]);
    const offset = () =>
      page.locator("main").evaluate((m) => {
        const b = [...m.querySelectorAll<HTMLElement>(".actions button[data-action]")].pop()!;
        return Math.round(b.getBoundingClientRect().top - m.getBoundingClientRect().top);
      });
    const before = await offset();
    await tapHexId(page, hasTouch, "M35");
    await expect(card(page)).toBeVisible();
    expect(await offset(), "the buttons are not displaced").toBe(before);
    await page.locator("#hexcard-close").click();
    expect(await offset()).toBe(before);
  });
}
