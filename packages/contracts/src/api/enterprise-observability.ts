import type {
  EnterpriseAuditResult,
} from "./enterprise.js";
import type {
  EnterpriseUsageCategory,
  EnterpriseUsageUnit,
} from "./enterprise-billing.js";
import type {
  CommunicationProvider,
} from "../communication/provider-adapters.js";
import type {
  ProviderOperationStatus,
  ProviderOperationType,
} from "../communication/provider-operations.js";

export const enterpriseClientEventKinds = [
  "error",
  "unhandled_rejection",
  "performance",
] as const;

export type EnterpriseClientEventKind = typeof enterpriseClientEventKinds[number];

export interface EnterpriseClientEventRequest {
  kind: EnterpriseClientEventKind;
  code: string;
  routePath: string;
  appVersion: string;
  releaseCommit: string;
  occurredAt: string;
  fingerprint?: string;
  metricName?: string;
  value?: number;
}

export interface EnterpriseClientEventResponse {
  accepted: true;
  traceId: string;
}

export interface EnterpriseSessionTraceReportResponse {
  generatedAt: string;
  session: {
    id: string;
    kind: "meeting" | "support" | "marketing";
    businessId: string;
    status: string;
    policyVersion: string;
    entitlementVersion: string;
    traceId: string;
    startedAt: string;
    endedAt?: string;
  };
  traceIds: string[];
  quality: {
    status: "available" | "no_samples";
    segmentCount: number;
    translatedSegmentCount: number;
    translationCoverage: number | null;
    latencySampleCount: number;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
    providerFailureCount: number;
  };
  usage: Array<{
    eventId: string;
    ledgerEntryId: string;
    category: EnterpriseUsageCategory;
    unit: EnterpriseUsageUnit;
    amount: number;
    sourceType: string;
    sourceRef: string;
    traceId: string;
    occurredAt: string;
  }>;
  monetaryCost: {
    status: "not_configured";
    currency?: string;
    amount: null;
    reasonCode: "pricing_not_configured";
  };
  providerOperations: Array<{
    id: string;
    provider: CommunicationProvider;
    operationType: ProviderOperationType;
    status: ProviderOperationStatus;
    traceId?: string;
    startedAt: string;
    endedAt?: string;
  }>;
  auditEvents: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    result: EnterpriseAuditResult;
    traceId: string;
    createdAt: string;
  }>;
}
