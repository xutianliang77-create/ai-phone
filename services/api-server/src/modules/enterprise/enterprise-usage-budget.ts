import type {
  EnterpriseUsageCategory,
  EnterpriseUsageUnit,
} from "@translation/contracts";

export interface EnterpriseUsageBudgetRecord {
  id: string;
  tenantId: string;
  billingAccountId: string;
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  limitAmount: number;
  alertThresholdPercent: number;
  status: "active" | "paused";
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseUsageHoldRecord {
  id: string;
  tenantId: string;
  billingAccountId: string;
  budgetId: string;
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  amount: number;
  settledAmount?: number;
  status: "held" | "settled" | "released" | "expired";
  sourceType: string;
  sourceRef: string;
  idempotencyKey: string;
  requestHash: string;
  heldAt: string;
  expiresAt: string;
  settledAt?: string;
  releasedAt?: string;
  updatedAt: string;
  version: number;
}

export interface ConfigureEnterpriseUsageBudgetInput {
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  limitAmount: number;
  alertThresholdPercent: number;
  periodStart: string;
  periodEnd: string;
  expectedVersion?: number;
  now?: Date;
}

export interface HoldEnterpriseUsageInput {
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  amount: number;
  sourceType: string;
  sourceRef: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: string;
  now?: Date;
}

export interface SettleEnterpriseUsageInput {
  holdId: string;
  amount: number;
  idempotencyKey: string;
  requestHash: string;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean | null>;
  now?: Date;
}

export type ConfigureEnterpriseUsageBudgetResult =
  | { status: "created" | "updated"; budget: EnterpriseUsageBudgetRecord }
  | { status: "conflict" }
  | { status: "period_overlap" };

export type HoldEnterpriseUsageResult =
  | { status: "created" | "replayed"; hold: EnterpriseUsageHoldRecord }
  | { status: "budget_not_configured" | "budget_paused" }
  | { status: "idempotency_conflict" }
  | { status: "budget_exhausted"; used: number; held: number; limit: number };

export type SettleEnterpriseUsageResult =
  | { status: "settled" | "replayed"; hold: EnterpriseUsageHoldRecord }
  | { status: "not_found" | "hold_not_active" | "amount_exceeds_hold" }
  | { status: "idempotency_conflict" };
