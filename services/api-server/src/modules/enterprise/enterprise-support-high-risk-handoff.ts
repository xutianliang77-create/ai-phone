import { enterpriseSupportAgentRequestHash } from "./enterprise-support-agent.js";

export const enterpriseSupportHighRiskHandoffPolicyVersion = "ent-cs-008.v1";
export type EnterpriseSupportHighRiskCategory =
  "refund" | "payment" | "identity" | "other_high_risk";

export interface EnterpriseSupportHighRiskHandoffRecord {
  id: string;
  tenantId: string;
  supportSessionId: string;
  customerId: string;
  supportAgentRunId: string;
  toolDefinitionId: string;
  toolName: string;
  toolRevision: number;
  riskCategory: EnterpriseSupportHighRiskCategory;
  policyVersion: typeof enterpriseSupportHighRiskHandoffPolicyVersion;
  argumentsHash: string;
  riskEvidenceHash: string;
  requestHash: string;
  idempotencyKey: string;
  createdAt: string;
}

export function enterpriseSupportHighRiskCategory(
  toolName: string,
): EnterpriseSupportHighRiskCategory {
  if (toolName === "refund.request" || toolName.startsWith("refund.")) return "refund";
  if (toolName === "payment.change.request" || toolName.startsWith("payment.")) {
    return "payment";
  }
  if (toolName === "identity.verification.request" || toolName.startsWith("identity.")) {
    return "identity";
  }
  return "other_high_risk";
}

export function enterpriseSupportHighRiskEvidenceHash(input: {
  toolDefinitionId: string;
  toolName: string;
  toolRevision: number;
  argumentsHash: string;
}) {
  return enterpriseSupportAgentRequestHash({
    policyVersion: enterpriseSupportHighRiskHandoffPolicyVersion,
    riskLevel: "high_risk",
    authorizationScope: "support:takeover",
    confirmationMode: "human_handoff",
    riskCategory: enterpriseSupportHighRiskCategory(input.toolName),
    ...input,
  });
}
