import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The Redeploy panel of step 9e (spec 16 D4, D6, ticket 16-19) in a real browser, with a mouse and with a finger. The game is the one of axis-at-7h.json with
 * step 7h and step 8b ended, so it waits at step 9e of the first Axis Player Turn: Germany has 9 redeployments and units in Berlin (L31), Metz (P24), P25 and L34.
 */

type Pt = readonly [number, number];
const FIXTURE = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { scenario: string; seed: number; actions: unknown[] };
const TO_9E = [...FIXTURE.actions, { type: "END_STEP", side: "axis", step: "7h" }, { type: "END_STEP", side: "axis", step: "8b" }];

async function load(page: Page, size?: Pt): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (size) await page.setViewportSize({ width: size[0], height: size[1] });
  await page.goto("/?e2e");
  await page.evaluate((detail) => document.dispatchEvent(new CustomEvent("e2e-load", { detail })), { scenario: FIXTURE.scenario, side: "axis", seed: FIXTURE.seed, actions: TO_9E });
  await expect(page.locator(".turn")).toContainText("step 9e");
  return errors;
}
const press = (loc: Locator, touch: boolean, force = false) => (touch ? loc.tap({ force }) : loc.click({ force }));
const undo = (page: Page) => page.locator("#sr-undo");
const allow = (page: Page) => page.locator(".sr-allow").first();
const row = (page: Page, hex: string) => page.locator(`button.sr-row[data-srstack="${hex}"]`);

/** Chooses the stack, opens "Where they can go" and presses its first row: the confirm card shows. Returns the hex chosen. */
async function chooseAndPick(page: Page, touch: boolean, from: string): Promise<string> {
  await press(row(page, from), touch);
  await expect(page.locator("#sr-card-title")).toBeFocused();
  await press(page.locator("#sr-where-sum"), touch);
  const first = page.locator("button.sr-dest").first();
  const hex = (await first.getAttribute("data-srdest"))!;
  await press(first, touch);
  await expect(page.locator("#sr-confirm")).toBeVisible();
  return hex;
}

test("the panel names the allowance and the stacks; a stack, a yellow hex, a confirm card and a redeployment; taking it back restores the game", async ({ page, hasTouch }) => {
  const errors = await load(page);
  await expect(allow(page)).toHaveText("Germany 9 of 9 left.");
  await expect(page.locator("#sr-title")).toHaveText("Redeploy");
  await expect(row(page, "L31")).toContainText("Berlin (L31)");
  await expect(row(page, "L31")).toContainText("1 unit can be redeployed");
  await expect(page.locator(".sr-cannot summary")).toContainText("Units that cannot be redeployed");
  await expect(undo(page)).toBeDisabled();
  await expect(page.locator("#sr-undo-why")).toHaveText("Nothing to take back: no redeployment made yet.");
  await expect(page.locator(".nextbar button[data-action]")).toHaveText("Done with redeployment");
  const logBefore = await page.locator(".log li").count();

  const to = await chooseAndPick(page, hasTouch, "L31");
  await expect(page.locator(".sr-question")).toContainText("Redeploy 3-3 German infantry from Berlin (L31) to ");
  await expect(page.locator(".sr-left")).toHaveText("Germany will have 8 left.");
  await press(page.locator("#sr-confirm"), hasTouch);
  await expect(allow(page)).toHaveText("Germany 8 of 9 left.");
  const line = page.locator(".log li").filter({ hasText: "redeployed from Berlin (L31)" });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("Germany has 8 left");
  await expect(page.locator(`g.units g[data-at='${to}']`).first()).toBeVisible();
  await expect(undo(page)).toBeEnabled();
  await expect(page.locator("#sr-undo-why")).toContainText("Last redeployment: Redeployed 3-3 German infantry from Berlin (L31)");

  await press(undo(page), hasTouch);
  await expect(allow(page)).toHaveText("Germany 9 of 9 left.");
  await expect(page.locator(".log li")).toHaveCount(logBefore);
  await expect(page.locator(".toast")).toContainText("Took back: Redeployed 3-3 German infantry from Berlin (L31)");
  await expect(row(page, "L31")).toBeVisible();
  await expect(undo(page)).toBeDisabled();
  expect(errors).toEqual([]);
});

test("a tap on the map chooses a stack, shades where it can go, and a tap on a hex that cannot be chosen says why", async ({ page, hasTouch }) => {
  await load(page);
  const at = (id: string) =>
    page.locator(`svg.map polygon[data-id="${id}"]`).evaluate((p) => {
      const r = p.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2] as const;
    });
  const tap = async (id: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const pt = await at(id);
    if (hasTouch) await page.touchscreen.tap(pt[0], pt[1]);
    else await page.mouse.click(pt[0], pt[1]);
  };
  await tap("L31");
  await expect(page.locator("#sr-card-title")).toHaveText("Redeploy from Berlin (L31)");
  await expect(page.locator("g.highlights polygon").first()).toBeAttached();
  await tap("L35"); // German units there are next to the enemy: not a place to go
  await expect(page.locator(".toast")).toContainText(/enemy/);
  await tap("L31"); // the chosen hex again lets it go
  await expect(page.locator("#sr-card-title")).toHaveCount(0);
  await expect(page.locator("#sr-title")).toBeVisible();
});

test("Escape and Cancel throw the choice away; Done with redeployment moves on and the panel is gone", async ({ page, hasTouch }) => {
  await load(page);
  await press(row(page, "P24"), hasTouch);
  await expect(page.locator("#sr-card-title")).toBeVisible();
  await expect(page.locator("button.sr-line")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#sr-card-title")).toHaveCount(0);
  await press(row(page, "P24"), hasTouch);
  await press(page.locator("#sr-cancel"), hasTouch);
  await expect(page.locator("#sr-card-title")).toHaveCount(0);
  await press(page.locator(".nextbar button[data-action]").last(), hasTouch);
  await expect(page.locator(".turn")).not.toContainText("step 9e");
  await expect(page.locator(".srpanel")).toHaveCount(0);
});

for (const size of [[1024, 768], [768, 1024], [390, 844]] as const) {
  test(`${size[0]}x${size[1]}: every button of the panel is 44 px tall, on screen where it matters, and nothing scrolls sideways`, async ({ page, hasTouch }) => {
    await load(page, size);
    const check = async (state: string) => {
      for (const b of await page.locator(".srpanel button, .nextbar button").all()) {
        const box = (await b.boundingBox())!;
        expect(box.height, `${state}: ${await b.innerText()}`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${state}: ${await b.innerText()}`).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${state}: no sideways scroll`).toBe(true);
    };
    await check("the list");
    await chooseAndPick(page, hasTouch, "L31");
    await check("the confirm card");
  });
}
