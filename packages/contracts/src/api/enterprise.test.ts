import { describe, expect, it } from "vitest";
import {
  enterpriseAuditResults,
  enterpriseScopes,
  isEnterpriseAuditResult,
  isEnterpriseMemberRole,
  isEnterpriseScope,
} from "./enterprise.js";

describe("enterprise contracts", () => {
  it("recognizes only declared roles and scopes", () => {
    expect(isEnterpriseMemberRole("support_agent")).toBe(true);
    expect(isEnterpriseMemberRole("root")).toBe(false);
    for (const scope of enterpriseScopes) {
      expect(isEnterpriseScope(scope)).toBe(true);
    }
    expect(isEnterpriseScope("member:delete")).toBe(false);
  });

  it("recognizes only declared audit results", () => {
    for (const result of enterpriseAuditResults) {
      expect(isEnterpriseAuditResult(result)).toBe(true);
    }
    expect(isEnterpriseAuditResult("success")).toBe(false);
  });
});
