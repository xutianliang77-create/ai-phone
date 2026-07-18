import { describe, expect, it } from "vitest";
import {
  enterpriseMemberRoles,
  enterpriseScopes,
  type EnterpriseMemberRole,
  type EnterpriseScope,
} from "@translation/contracts";
import {
  enterpriseScopesForRole,
  hasEnterpriseScope,
} from "./enterprise-rbac.js";

const expectedScopes: Record<EnterpriseMemberRole, readonly EnterpriseScope[]> = {
  owner: enterpriseScopes,
  admin: enterpriseScopes,
  marketing_manager: [
    "tenant:read",
    "knowledge:read",
    "knowledge:publish",
    "campaign:read",
    "campaign:write",
    "campaign:approve",
  ],
  marketing_member: [
    "tenant:read",
    "knowledge:read",
    "campaign:read",
    "campaign:write",
  ],
  support_manager: [
    "tenant:read",
    "knowledge:read",
    "knowledge:publish",
    "support:read",
    "support:manage",
    "support:takeover",
  ],
  support_agent: [
    "tenant:read",
    "knowledge:read",
    "support:read",
    "support:takeover",
  ],
  meeting_host: [
    "tenant:read",
    "meeting:read",
    "meeting:write",
    "screen_share:stop",
  ],
  member: ["tenant:read", "meeting:read"],
  auditor: [
    "tenant:read",
    "member:read",
    "knowledge:read",
    "campaign:read",
    "support:read",
    "meeting:read",
    "billing:read",
    "usage:read",
    "audit:read",
    "audit:export",
  ],
};

describe("enterprise RBAC", () => {
  it.each(enterpriseMemberRoles)(
    "enforces the exact operation and resource matrix for %s",
    (role) => {
      expect(enterpriseScopesForRole(role)).toEqual(expectedScopes[role]);
      for (const scope of enterpriseScopes) {
        expect(hasEnterpriseScope(role, scope)).toBe(
          expectedScopes[role].includes(scope),
        );
      }
    },
  );
});
