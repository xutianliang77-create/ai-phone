import { describe, expect, it } from "vitest";
import {
  enterpriseSupportHighRiskCategory,
  enterpriseSupportHighRiskEvidenceHash,
} from "./enterprise-support-high-risk-handoff.js";

describe("enterprise high risk support handoff policy", () => {
  it("classifies refund, payment, identity, and unknown high-risk tools", () => {
    expect(enterpriseSupportHighRiskCategory("refund.request")).toBe("refund");
    expect(enterpriseSupportHighRiskCategory("payment.change.request")).toBe("payment");
    expect(enterpriseSupportHighRiskCategory("identity.verification.request"))
      .toBe("identity");
    expect(enterpriseSupportHighRiskCategory("contract.change"))
      .toBe("other_high_risk");
  });

  it("binds evidence to policy, definition revision, and argument hash", () => {
    const common = { toolDefinitionId: "10000000-0000-4000-8000-000000000001",
      toolName: "refund.request", toolRevision: 2,
      argumentsHash: "a".repeat(64) };
    const evidence = enterpriseSupportHighRiskEvidenceHash(common);
    expect(evidence).toMatch(/^[a-f0-9]{64}$/);
    expect(enterpriseSupportHighRiskEvidenceHash({ ...common, toolRevision: 3 }))
      .not.toBe(evidence);
    expect(enterpriseSupportHighRiskEvidenceHash({
      ...common, argumentsHash: "b".repeat(64),
    })).not.toBe(evidence);
  });
});
