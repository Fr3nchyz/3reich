import { expect, test } from "@playwright/test";
import { advanceTurnStep } from "./turn-helpers";

/**
 * The player picks a side and the computer plays the other: start a 1939 game on each side, let the
 * game set up the rest, end a few Game Turns, and check the computer played (status shown, its
 * choices in the log) and nothing broke.
 */

for (const side of ["axis", "allies"] as const) {
  test(`1939 scenario, ${side}: the computer plays the other side's turns`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.locator("#scenario").selectOption("1939");
    await page.locator("#side").selectOption(side);
    await page.locator("#newgame").click();
    await expect(page.locator(".setup h2")).toContainText("Your setup");
    for (let i = 0; i < 12 && (await page.locator("#fill").count()); i++) await page.locator("#fill").click();
    await expect(page.locator(".turn")).toContainText("player turn");

    const turn = async () => (await page.locator(".turn").innerText()).split("—")[0]!.trim();
    const start = await turn();
    const seen = new Set<string>();
    let sawStatus = false;
    // #351/#354: end the displayed step, including optional stops; the computer plays in between.
    for (let i = 0; i < 80 && seen.size < 3; i++) {
      seen.add(await turn());
      if (await page.locator(".computer-status").count()) sawStatus = true;
      await advanceTurnStep(page);
    }
    expect(seen.size, `Game Turns seen: ${[...seen].join(", ")}`).toBeGreaterThanOrEqual(3);
    expect(await turn()).not.toBe(start);
    expect(sawStatus, "the status 'Computer is playing' was shown").toBe(true);

    const log = await page.locator("ol.log").innerText();
    expect(log).toMatch(/Computer \((Axis|Allied)\):/);
    expect(errors).toEqual([]);
  });
}
