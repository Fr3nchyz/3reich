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
