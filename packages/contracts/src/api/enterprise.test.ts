import { describe, expect, it } from "vitest";
import {
  enterpriseAuditResults,
  enterpriseExecutionPreferences,
  enterpriseSensitiveFeatureModes,
  enterpriseScopes,
  isEnterpriseAuditResult,
  isEnterpriseMemberRole,
  isEnterpriseExecutionPreference,
  isEnterpriseSensitiveFeatureMode,
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

  it("recognizes only declared communication policy values", () => {
    for (const value of enterpriseExecutionPreferences) {
      expect(isEnterpriseExecutionPreference(value)).toBe(true);
    }
    for (const value of enterpriseSensitiveFeatureModes) {
      expect(isEnterpriseSensitiveFeatureMode(value)).toBe(true);
    }
    expect(isEnterpriseExecutionPreference("automatic")).toBe(false);
    expect(isEnterpriseSensitiveFeatureMode("enabled_without_consent")).toBe(false);
  });

  it("recognizes only declared audit results", () => {
    for (const result of enterpriseAuditResults) {
      expect(isEnterpriseAuditResult(result)).toBe(true);
    }
    expect(isEnterpriseAuditResult("success")).toBe(false);
  });
});
