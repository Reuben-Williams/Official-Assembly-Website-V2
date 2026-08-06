import { expect, test } from "@playwright/test";

test("public newsletter routes are direct, truthful, and fail closed while disabled", async ({ page }) => {
  const response = await page.goto("/newsletter");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "District Newsletter" })).toBeVisible();
  await expect(page.locator("[data-builder-form-unavailable=true]")).toBeVisible();
  await expect(page.locator('form[action="/api/forms/newsletter-signup"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();

  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
  await expect(page.getByText("You are not subscribed until you deliberately complete the confirmation step sent to your inbox.")).toBeVisible();
});

test("confirmation and bookmarked Forms routes do not leak tokens or bypass staff login", async ({ page }) => {
  await page.goto("/newsletter/confirm#token=newsletter-token-value");
  await expect(page.getByRole("heading", { level: 1, name: "Confirm your subscription" })).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("newsletter-token-value");

  await page.goto("/admin/editor?workspace=website.forms");
  await expect(page).toHaveURL(/\/admin\/login\?returnTo=/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/admin/editor?workspace=website.forms");
  await expect(page.getByRole("heading", { level: 1, name: "Site Editor" })).toBeVisible();
});

test("newsletter and privacy pages remain contained at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/newsletter", "/privacy"] as const) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  }
});
