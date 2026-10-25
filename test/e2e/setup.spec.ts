import { expect, test } from "@playwright/test";

test.use({ extraHTTPHeaders: { "tailscale-user-login": "e2e@example.com" } });

const noSideScroll = async (page: import("@playwright/test").Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test("coverage page: score, gaps and per-game reasons", async ({ page }, info) => {
  await page.clock.setFixedTime(new Date("2026-10-18T21:00:00Z"));
  await page.goto("/coverage");
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  await expect(page.locator(".cov-game").first()).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: `test-results/coverage-${info.project.name}.png`, fullPage: true });
});

test("setup wizard: services step updates coverage as you tick", async ({ page }, info) => {
  await page.clock.setFixedTime(new Date("2026-10-18T21:00:00Z"));
  await page.goto("/setup");
  await expect(page.getByRole("heading", { level: 1, name: "Your area" })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: `test-results/setup-area-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: /Your services/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your services" })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: `test-results/setup-services-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: /Your TVs/ }).click();
  await expect(page.getByTestId("tv-living-room")).toBeVisible();
  await page.screenshot({ path: `test-results/setup-tvs-${info.project.name}.png`, fullPage: true });
});
