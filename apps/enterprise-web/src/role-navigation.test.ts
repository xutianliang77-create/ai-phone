import {
  enterpriseMemberRoles,
  enterpriseRoleScopes,
  type EnterpriseMemberRole,
} from "@translation/contracts";
import { describe, expect, it } from "vitest";
import {
  discoverEnterpriseNavigation,
  routeAllowed,
} from "./navigation.js";

const expectedRoutes: Record<EnterpriseMemberRole, readonly string[]> = {
  owner: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  admin: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  marketing_manager: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics", "/settings"],
  marketing_member: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics", "/settings"],
  support_manager: ["/", "/support", "/contacts", "/knowledge", "/analytics", "/settings"],
  support_agent: ["/", "/support", "/contacts", "/knowledge", "/settings"],
  meeting_host: ["/", "/meetings", "/analytics", "/settings"],
  member: ["/", "/meetings", "/analytics", "/settings"],
  auditor: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
};

describe("enterprise role route discovery", () => {
  it.each(enterpriseMemberRoles)("discovers the exact %s navigation", (role) => {
    const navigation = discoverEnterpriseNavigation(enterpriseRoleScopes[role]);
    expect(navigation.map(({ path }) => path)).toEqual(expectedRoutes[role]);
  });

  it("guards direct and nested routes even when their entry is hidden", () => {
    const memberScopes = enterpriseRoleScopes.marketing_member;
    expect(routeAllowed(memberScopes, "/support")).toBe(false);
    expect(routeAllowed(memberScopes, "/support/session-a")).toBe(false);
    expect(routeAllowed(memberScopes, "/campaigns/campaign-a")).toBe(true);
  });
});
