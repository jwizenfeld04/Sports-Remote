import { expect, test, type Page } from "@playwright/test";

test.use({ extraHTTPHeaders: { "tailscale-user-login": "e2e@example.com" } });

async function signIn(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-18T21:00:00Z"));
  await page.goto("/");
  await expect(page.getByTestId("search-input")).toBeVisible();
}

test("search, filter, launch, app-only panel with remote", async ({ page }, info) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: /your teams/i })).toHaveCount(0);
  await page.getByTestId("search-input").fill("giants");
  await page.getByTestId("filter-league-nfl").click();
  const card = page.getByTestId("game-card-nfl-402").first();
  await expect(card).toContainText("Plex");
  await card.locator(".card-main").click();
  await expect(page.getByTestId("launch-route-reason")).toContainText("Your local team");
  await page.getByTestId("service-select").click();
  const menu = page.getByRole("listbox", { name: "Watch on" });
  await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: /Fox One/ }).click();
  await expect(page.getByTestId("service-select")).toContainText("Fox One");
  await page.getByTestId("send-to-tv").click();
  const panel = page.getByTestId("launch-toast");
  await expect(panel).toContainText("Fox One");
  await page.getByTestId("remote-select").click();
  await page.getByTestId("result-done").click();
  await expect(panel).toHaveCount(0);
  await page.screenshot({ path: `test-results/${info.project.name}.png`, fullPage: false });
});

test("layout: no horizontal scroll, touch targets at least 44px", async ({ page }, info) => {
  await signIn(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, select, input")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ el: (el as HTMLElement).dataset.testid ?? el.textContent?.slice(0, 20), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 40 || r.width < 40)
      .map(({ el }) => el),
  );
  expect(small).toEqual([]);
  expect(await page.locator("select").count()).toBe(0);
  // Search and the league/view segments stay pinned; the rest of the filters sit in a popover on every size.
  await expect(page.getByTestId("filter-league-nhl")).toBeVisible();
  await expect(page.getByTestId("view-live")).toBeVisible();
  await expect(page.getByTestId("filter-popover")).toHaveCount(0);
  await page.getByTestId("filters-toggle").click();
  await expect(page.getByTestId("filter-status-live")).toBeVisible();
  await expect(page.getByTestId("filter-popover")).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("filter-popover")).toHaveCount(0);
  await page.mouse.wheel(0, 1500);
  await expect(page.locator(".topbar")).toBeInViewport();
  // Grid: 1 column on phones, 2 on tablets, 3+ on desktop.
  const cols = await page.locator("main .grid").first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(cols).toBe({ phone: 1, tablet: 2, desktop: 3 }[info.project.name] ?? cols);
});

test("URL keeps filters (bookmarkable)", async ({ page }) => {
  await signIn(page);
  await page.goto("/?q=kings&league=nhl");
  await expect(page.getByTestId("search-input")).toHaveValue("kings");
  await expect(page.getByTestId(/game-card-nhl-/).first()).toBeVisible();
  await expect(page.getByTestId(/game-card-nfl-/)).toHaveCount(0);
});

test("pop-up menus: keyboard, stay inside the viewport, popover filters apply", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("filters-toggle").click();
  const trigger = page.getByTestId("filter-time");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByTestId("filter-time-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toBeInViewport({ ratio: 1 });
  await expect(menu.getByRole("option", { name: /This week/ })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown"); // Tonight
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/time=tonight/);
  await expect(page.getByTestId("filter-popover")).toBeVisible();
  await page.getByTestId("filter-close").click();
  await expect(page).toHaveURL(/close=1/);
  await expect(page.getByTestId("filters-toggle")).toContainText("2");
  await page.mouse.click(5, 600);
  await expect(page.getByTestId("filter-popover")).toHaveCount(0);
  await expect(page.getByTestId("token-close")).toBeVisible();
  await page.getByTestId("tokens-clear").click();
  await expect(page).toHaveURL(/\/$/);
  // The Watch menu in the launch sheet stays on screen too (flips up when needed).
  await page.getByTestId("game-card-nfl-402").first().locator(".card-main").click();
  await page.getByTestId("service-select").click();
  await expect(page.getByRole("listbox", { name: "Watch on" })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("launch-sheet")).toBeVisible();
});

test("the Content-Security-Policy blocks nothing the app needs", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await signIn(page);
  // The inline bootstrap state is a JSON data block, not a script: it's read even under script-src 'self'.
  expect(await page.locator("#sr-state").count()).toBe(1);
  await page.getByTestId("game-card-nfl-402").first().locator(".card-main").click();
  await expect(page.getByTestId("launch-sheet")).toBeVisible();
  expect(violations).toEqual([]);
  const csp = (await page.request.get("/")).headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
});

test("app icons are served and wired into the manifest", async ({ page }) => {
  await signIn(page);
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  const paths = ["/icon.svg", "/favicon-32.png", "/apple-touch-icon.png", ...manifest.icons.map((i: { src: string }) => i.src)];
  for (const p of new Set(paths)) expect((await page.request.get(p)).status(), p).toBe(200);
  await expect(page.locator(".topbar .brand-mark")).toHaveAttribute("src", "/icon.svg");
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")).toBe("/apple-touch-icon.png");
});
