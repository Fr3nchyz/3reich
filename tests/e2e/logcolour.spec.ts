import { expect, test, type Page } from "@playwright/test";

/** The activity log by side: two computers play, so lines of both sides appear; Axis is red with a solid bar, the Allies blue with a dashed one, a note stays plain. */

const rgb = (c: string): [number, number, number] => c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number) as [number, number, number];
const lum = (c: [number, number, number]) => {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };

async function look(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((li) => {
    const s = getComputedStyle(li);
    return { color: s.color, borderStyle: s.borderLeftStyle, borderWidth: s.borderLeftWidth, background: getComputedStyle(li.closest("ol")!).backgroundColor, text: li.textContent ?? "" };
  });
}

test("watching two computers: Axis lines are red with a solid bar, Allied lines blue with a dashed bar, notes plain", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.locator("#scenario").selectOption("1939");
  await page.locator("#side").selectOption("watch");
  await page.locator("#seed").fill("11");
  await page.locator("#newgame").click();
  await page.locator("#w-speed").selectOption("fast");
  await expect(page.locator("ol.log li.log-axis").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("ol.log li.log-allies").first()).toBeVisible({ timeout: 30_000 });
  await page.locator("#w-play").click(); // pause: the log stops changing under the checks
  await expect(page.locator("#w-play")).toHaveText("Play");

  const axis = await look(page, "ol.log li.log-axis");
  const allies = await look(page, "ol.log li.log-allies");
  const note = await look(page, "ol.log li:not(.log-axis):not(.log-allies):not(.log-more)");
  expect(axis.color).not.toBe(allies.color);
  expect(axis.color).not.toBe(note.color);
  expect(allies.color).not.toBe(note.color);
  const [ar, ag, ab] = rgb(axis.color), [lr, lg, lb] = rgb(allies.color);
  expect(ar, "Axis is red").toBeGreaterThan(Math.max(ag, ab) * 2);
  expect(lb, "Allies are blue").toBeGreaterThan(Math.max(lr * 3, lg * 1.5));
  expect(contrast(axis.color, axis.background), "readable (WCAG AA)").toBeGreaterThanOrEqual(4.5);
  expect(contrast(allies.color, allies.background)).toBeGreaterThanOrEqual(4.5);
  expect(axis.borderStyle, "not by colour alone").toBe("solid");
  expect(allies.borderStyle).toBe("dashed");
  expect(note.borderStyle).toBe("none");

  // The side of each computer line matches the side it names.
  const wrong = await page.locator("ol.log li").evaluateAll((lis) => lis.filter((li) => /^Computer \(Axis\)/.test(li.textContent) !== li.classList.contains("log-axis") && li.textContent.startsWith("Computer (")).map((li) => li.textContent));
  expect(wrong).toEqual([]);
});
