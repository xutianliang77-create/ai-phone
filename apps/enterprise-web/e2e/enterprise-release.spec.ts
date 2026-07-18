import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installEnterpriseFixture } from "./enterprise-fixture.js";

const viewports = [320, 600, 960, 1280, 1440] as const;

for (const width of viewports) {
  test(`dashboard has no page overflow at ${width}px in both themes`, async ({ page }) => {
    await installEnterpriseFixture(page, "member");
    await page.setViewportSize({ width, height: width === 320 ? 720 : 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
    await expectPageWidth(page);
    await expect(page.locator(".app-shell")).toHaveScreenshot(
      `dashboard-${width}-light.png`,
    );

    await page.getByLabel("界面主题").selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectPageWidth(page);
    await expect(page.locator(".app-shell")).toHaveScreenshot(
      `dashboard-${width}-dark.png`,
    );
  });
}

test("theme preference persists and 200% dynamic type keeps core actions reachable", async ({ page }) => {
  await installEnterpriseFixture(page, "member");
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");
  await page.getByLabel("界面主题").selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.getByRole("button", { name: /刷新/ })).toBeVisible();
  await expect(page.getByLabel("界面主题")).toBeVisible();
  await expectPageWidth(page);
});

test("skip link, named controls and WCAG A/AA automated rules remain clean", async ({ page }) => {
  await installEnterpriseFixture(page, "member");
  await page.goto("/");
  await page.locator("main").evaluate((element) => (element as HTMLElement).blur());
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳至主要内容" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#enterprise-main")).toBeFocused();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("client errors emit only a fingerprint and release context", async ({ page }) => {
  const fixture = await installEnterpriseFixture(page, "member");
  await page.goto("/");
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", {
      error: new Error("sensitive customer value must never leave the browser"),
    }));
  });
  await expect.poll(() => fixture.clientEvents.some(({ kind }) => kind === "error"))
    .toBe(true);
  const event = fixture.clientEvents.find(({ kind }) => kind === "error");
  expect(event).toMatchObject({
    kind: "error",
    code: "unexpected_client_error",
    routePath: "/",
  });
  expect(event?.fingerprint).toMatch(/^[a-f0-9]{32}$/);
  expect(JSON.stringify(event)).not.toContain("sensitive customer value");
});

async function expectPageWidth(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}
