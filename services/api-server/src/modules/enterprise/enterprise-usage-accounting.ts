import type {
  EnterpriseUsageCategory,
  EnterpriseUsageUnit,
} from "@translation/contracts";

export interface EnterpriseUsageEventRecord {
  id: string;
  tenantId: string;
  billingAccountId: string;
  budgetId?: string;
  holdId?: string;
  ledgerEntryId: string;
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  amount: number;
  sourceType: string;
  sourceRef: string;
  idempotencyKey: string;
  requestHash: string;
  traceId: string;
  occurredAt: string;
  receivedAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface EnterpriseUsageAdjustmentRecord {
  id: string;
  tenantId: string;
  billingAccountId: string;
  targetLedgerEntryId: string;
  adjustmentLedgerEntryId: string;
  deltaAmount: number;
  reasonCode: string;
  idempotencyKey: string;
  requestHash: string;
  actorId: string;
  createdAt: string;
}

export interface EnterpriseUsagePeriodAggregateRecord {
  id: string;
  tenantId: string;
  billingAccountId: string;
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  periodStart: string;
  periodEnd: string;
  settledAmount: number;
  adjustmentAmount: number;
  netAmount: number;
  settlementCount: number;
  usageEventCount: number;
  adjustmentCount: number;
  ledgerCount: number;
  ledgerHash: string;
  sourceWatermark?: string;
  computedAt: string;
  version: number;
}

export interface RecordEnterpriseUsageEventInput {
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  amount: number;
  sourceType: string;
  sourceRef: string;
  idempotencyKey: string;
  requestHash: string;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean | null>;
  now?: Date;
}

export interface AdjustEnterpriseUsageInput {
  targetLedgerEntryId: string;
  deltaAmount: number;
  reasonCode: string;
  idempotencyKey: string;
  now?: Date;
}

export interface RebuildEnterpriseUsagePeriodInput {
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  periodStart: string;
  periodEnd: string;
  expectedVersion?: number;
  now?: Date;
}

export type RecordEnterpriseUsageEventResult =
  | { status: "recorded" | "replayed"; event: EnterpriseUsageEventRecord }
  | { status: "idempotency_conflict" | "billing_account_unavailable" };

export type AdjustEnterpriseUsageResult =
  | { status: "adjusted" | "replayed"; adjustment: EnterpriseUsageAdjustmentRecord }
  | { status: "not_found" | "target_not_settlement" }
  | { status: "negative_net" | "idempotency_conflict" };

export type RebuildEnterpriseUsagePeriodResult =
  | { status: "rebuilt"; aggregate: EnterpriseUsagePeriodAggregateRecord }
  | { status: "conflict" | "billing_account_unavailable" };
