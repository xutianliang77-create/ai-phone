import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  EnterpriseSupportQualityDashboard,
  EnterpriseSupportQualityDetail,
  EnterpriseSupportQualityReviewRecord,
  EnterpriseSupportQualityRuleVersionRecord,
  EnterpriseSupportQualitySessionSummary,
} from "./enterprise-support-quality.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseSupportQualityRepositoryRuntime {
  publishSupportQualityRuleVersion?(input: {
    context: EnterpriseTenantContext; locale: string;
    identityDisclosurePhrases: string[]; prohibitedPromisePhrases: string[];
    idempotencyKey: string; publishedAt: string;
  }): Promise<
    | { status: "published" | "replayed";
        ruleVersion: EnterpriseSupportQualityRuleVersionRecord }
    | { status: "idempotency_conflict" | "invalid_arguments" }
    | StorageRequired
  >;
  listSupportQualityRuleVersions?(input: {
    context: EnterpriseTenantContext;
  }): Promise<{ status: "ready";
    ruleVersions: EnterpriseSupportQualityRuleVersionRecord[] } | StorageRequired>;
  analyzeSupportQualitySession?(input: {
    context: EnterpriseTenantContext; sessionId: string; analyzedAt: string;
  }): Promise<
    | { status: "analyzed" | "replayed";
        review: EnterpriseSupportQualityReviewRecord }
    | { status: "not_found" | "not_finalized" | "rule_not_configured" |
        "no_agent_data" | "conflict" }
    | StorageRequired
  >;
  getSupportQualityDashboard?(input: {
    context: EnterpriseTenantContext;
  }): Promise<{ status: "ready"; dashboard: EnterpriseSupportQualityDashboard;
    sessions: EnterpriseSupportQualitySessionSummary[] } | StorageRequired>;
  getSupportQualitySession?(input: {
    context: EnterpriseTenantContext; sessionId: string;
  }): Promise<{ status: "ready"; detail: EnterpriseSupportQualityDetail } |
    { status: "not_found" } | StorageRequired>;
}
