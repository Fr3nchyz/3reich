import { expect, test, type Page } from "@playwright/test";

/** Step 6f in a real browser: tap a stack of yours, tap a yellow hex, and the stack has moved; refusals and letting go. */

type Pt = readonly [number, number];

async function tapAt(page: Page, touch: boolean, pt: Pt): Promise<void> {
  if (touch) await page.touchscreen.tap(pt[0], pt[1]);
  else await page.mouse.click(pt[0], pt[1]);
}

/** Centres of the elements matching `selector` that lie fully inside the visible part of the map. */
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

const outlined = (page: Page) => page.locator("g.highlights polygon").count();

/** Taps visible counters until one of them is a stack that can move (its destinations get outlined). */
async function chooseAStack(page: Page, touch: boolean): Promise<Pt> {
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const pt of await visibleCentres(page, "g.units > g")) {
    await tapAt(page, touch, pt);
    if ((await outlined(page)) > 0) return pt;
  }
  throw new Error("no visible stack can move");
}

test("1939, Axis: step 6f, tap a stack then a yellow hex to move it; a refused tap says why; tapping the stack again lets it go", async ({ page, hasTouch }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("axis");
  await page.locator("#newgame").click();
  for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();

  // Steps 1 and 3 (Germany's free Eastern Front Offensive Option) on the way to step 6f.
  await expect(page.locator(".turn")).toContainText("step 1");
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 3");
  await page.locator("summary", { hasText: "Choose a Front Option" }).click();
  await page.getByRole("button", { name: "Eastern Front: Offensive Option", exact: true }).click();
  await page.locator(".actions button[data-action]").last().click();
  await expect(page.locator(".turn")).toContainText("step 6f");
  await expect(page.locator(".note").filter({ hasText: "Ground movement (step 6f)" })).toContainText("Done with step 6f");

  // Choosing a stack outlines its destinations; tapping it again lets it go.
  const stack = await chooseAStack(page, hasTouch);
  await tapAt(page, hasTouch, stack);
  await expect(page.locator("g.highlights polygon")).toHaveCount(0);
  await expect(page.locator("#maptoast")).toHaveText("");

  // A tap on a hex that is not a destination is refused in the line over the map and keeps the choice.
  await chooseAStack(page, hasTouch);
  const yellow = await outlined(page);
  const away = await page.locator("svg.map").evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const busy = [...svg.querySelectorAll("g.highlights polygon, g.units > g")].map((p) => p.getBoundingClientRect());
    const out: [number, number][] = [];
    for (let y = Math.max(box.top, 0) + 40; y < Math.min(box.bottom, window.innerHeight) - 40; y += 31) {
      for (let x = box.left + 40; x < Math.min(box.right, window.innerWidth) - 40; x += 37) {
        const onHex = document.elementFromPoint(x, y)?.closest("g.hexes") != null; // the map may be letterboxed
        if (onHex && !busy.some((r) => x > r.left - 20 && x < r.right + 20 && y > r.top - 20 && y < r.bottom + 20)) out.push([x, y]);
      }
    }
    return out.slice(0, 12);
  });
  let refused = false;
  for (const pt of away) {
    await tapAt(page, hasTouch, pt);
    if (/cannot get there/.test((await page.locator("#maptoast").textContent()) ?? "")) { refused = true; break; }
  }
  expect(refused, "a tap away from the yellow hexes is refused in the line over the map").toBe(true);
  expect(await outlined(page)).toBe(yellow);

  // Tapping a yellow hex moves the chosen stack there.
  await chooseAStack(page, hasTouch);
  const before = await page.locator(".log li").count();
  const dest = (await visibleCentres(page, "g.highlights polygon"))[0];
  if (!dest) throw new Error("no yellow hex is visible");
  await tapAt(page, hasTouch, dest);
  await expect(page.locator(".log li").filter({ hasText: /move from \w+ to \w+\./ })).not.toHaveCount(0);
  expect(await page.locator(".log li").count()).toBeGreaterThan(before);
  await expect(page.locator("g.highlights polygon")).toHaveCount(0);
  expect(errors).toEqual([]);
});
