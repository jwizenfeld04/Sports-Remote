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

test("setup wizard: every step works and fits on this screen", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-18T21:00:00Z"));
  page.on("dialog", (d) => void d.accept());
  await page.goto("/setup");
  const next = page.getByTestId("setup-next");
  const step = async (title: string) => {
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await noSideScroll(page);
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
  };

  await step("Your area");
  await expect(page.locator("select").first()).toBeVisible();
  await next.click();

  await step("Your teams");
  await next.click();

  await step("Your services");
  const peacock = page.getByTestId("svc-peacock").locator(".svc-toggle");
  await peacock.click();
  await expect(peacock).toHaveAttribute("aria-pressed", "true");
  await peacock.click(); // put it back
  await expect(peacock).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/\$\d/)).toHaveCount(0); // no prices anywhere
  await next.click();

  await step("Local teams");
  await next.click();

  await step("Your TVs");
  await expect(page.getByTestId("tv-living-room")).toBeVisible();
  await page.getByTestId("tv-host").fill("10.0.0.7");
  await page.getByTestId("tv-connect").click();
  await expect(page.getByText(/Found a Fire TV/)).toBeVisible();
  await page.getByTestId("tv-save").click();
  const den = page.locator('[data-testid^="tv-"]').filter({ hasText: "10.0.0.7" });
  await expect(den).toBeVisible();
  await noSideScroll(page);
  await den.getByRole("button", { name: "Remove" }).click();
  await expect(den).toHaveCount(0);
  await page.getByRole("radio", { name: "Google TV", exact: true }).click();
  await expect(page.getByPlaceholder("123456")).toBeVisible(); // pairing code
  await page.getByRole("radio", { name: "Connect directly" }).click();
  await expect(page.getByPlaceholder("123456")).toHaveCount(0);
  await expect(page.getByText(/turn on USB debugging/)).toBeVisible();
  await page.getByRole("radio", { name: "Other Android TV" }).click();
  await expect(page.getByPlaceholder("5555")).toBeVisible();
  await expect(page.getByRole("link", { name: /Step-by-step guide/ })).toBeVisible();
  await noSideScroll(page);
  await next.click();

  await step("Extras");
  await next.click();

  await step("Done");
  await expect(next).toHaveText("Start watching");
});
