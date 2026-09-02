import { expect, test } from "@playwright/test";

test("the current-resource empty state stays contained at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/resources");

  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-resource-state="empty"]')).toBeVisible();
  expect(await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))).toEqual({ documentWidth: 390, viewportWidth: 390 });
});
