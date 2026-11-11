import { expect, type Page } from "@playwright/test";

/** #351, spec 12 AER75: human starts enable manual fleet movement; decline it before ground movement. */
export async function passFleetMovement(page: Page): Promise<void> {
  await expect(page.locator(".turn")).toContainText("step 6b");
  await page.locator("#fleet-done").click();
  await expect(page.locator(".turn")).not.toContainText("step 6b");
}

/** #351, spec 09 AER76: optional fleet movement and the human defender's DAS answer have their own controls. */
export async function passOptionalStep(page: Page): Promise<boolean> {
  if (await page.locator("#fleet-done").count()) {
    await passFleetMovement(page);
    return true;
  }
  if (await page.locator("#air-mission-pass").count()) {
    await page.locator("#air-mission-pass").click();
    return true;
  }
  return false;
}

/** Walk the displayed step, rather than assuming which optional stops a scenario reaches.
 * #351 adds fleet/DAS answers; #354 adds 7b stops. Card-owned closing buttons also
 * sit outside .actions (notably the Free Siberian Transfer at 8a).
 */
export async function advanceTurnStep(page: Page): Promise<void> {
  let next = page.locator(".actions button").last();
  const turn = await page.locator(".turn").innerText();
  await expect.poll(async () => {
    // Give the computer time to finish its work without spending a walk iteration.
    if (await page.locator(".computer-status").count()) return false;
    const step = /step (\S+)/.exec(await page.locator(".turn").innerText())?.[1];
    const selectors = [
      "#minor-auto", "#minor-end-combat",
      ...(step === "6b" ? ["#fleet-done"] : []),
      "#fleet-pass", "#fleet-resolve", "#air-mission-pass", "#air-mission-resolve", "#sea-air-resolve",
      // Spec 16 D2: skip optional Attrition, or answer the computer's losses/retreat first.
      '[data-attrition-action="next"]', '[data-attrition-action="auto"]', '[data-attrition-action="confirm"]',
      ".attrition-card button[data-attrition-action]:enabled",
      ".siberian-buttons button[data-action]", ".winter-buttons button[data-action]", ".surrender-buttons button[data-action]",
      ".actions button",
    ];
    for (const selector of selectors) {
      const button = page.locator(selector).filter({ visible: true }).last();
      if (await button.count() && await button.isEnabled()) {
        next = button;
        return true;
      }
    }
    return false;
  }, { message: `A control to continue from ${turn}`, timeout: 15_000 }).toBe(true);
  await next.click();
  // Ticket 15-14-2 (#304): automatic minor placement is a draft until Done.
  if (await page.locator("#minor-done").count()) {
    await expect(page.locator("#minor-done")).toBeEnabled();
    await page.locator("#minor-done").click();
  }
}
