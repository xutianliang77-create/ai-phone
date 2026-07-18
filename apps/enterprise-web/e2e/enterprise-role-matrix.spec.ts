import { expect, test } from "@playwright/test";
import {
  enterpriseMemberRoles,
  type EnterpriseMemberRole,
} from "@translation/contracts";
import { installEnterpriseFixture } from "./enterprise-fixture.js";

const expectedRoutes: Record<EnterpriseMemberRole, readonly string[]> = {
  owner: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  admin: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  marketing_manager: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics", "/settings"],
  marketing_member: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics", "/settings"],
  support_manager: ["/", "/support", "/contacts", "/knowledge", "/analytics", "/settings"],
  support_agent: ["/", "/support", "/contacts", "/knowledge", "/analytics", "/settings"],
  meeting_host: ["/", "/meetings", "/analytics", "/settings"],
  member: ["/", "/meetings", "/analytics", "/settings"],
  auditor: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
};

for (const role of enterpriseMemberRoles) {
  test(`${role} discovers the exact server-scope navigation`, async ({ page }) => {
    await installEnterpriseFixture(page, role);
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "企业版主导航" });
    await expect(navigation).toBeVisible();
    const hrefs = await navigation.locator("a").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")));
    expect(hrefs).toEqual(expectedRoutes[role]);
  });
}

test("direct URL remains forbidden when navigation is hidden", async ({ page }) => {
  await installEnterpriseFixture(page, "marketing_member");
  await page.goto("/support/session-fixture");
  await expect(page.getByRole("heading", { name: "无权访问" })).toBeVisible();
  await expect(page.getByRole("link", { name: /AI 客服/ })).toHaveCount(0);
});
