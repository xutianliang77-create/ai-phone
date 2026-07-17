import type { BillingLedgerEntry } from "../billing/billing-records.js";
import type { UsageHoldRecord } from "./usage-hold-record.js";

export interface PostgresUsagePlan {
  code: string;
  monthlySeconds: number;
}

export interface PostgresUsageAccountRecord {
  userId: string;
  planCode: string;
  monthlySeconds: number;
  remainingSeconds: number;
  version: number;
  updatedAt: string;
}

export interface PostgresUsageBalance {
  userId: string;
  planCode: string;
  monthlySeconds: number;
  remainingSeconds: number;
  heldSeconds: number;
  availableSeconds: number;
}

export interface VersionedUsageHoldRecord extends UsageHoldRecord {
  version: number;
  requestHash: string;
}

export interface ImmutableBillingLedgerEntry extends BillingLedgerEntry {
  requestHash: string;
}
