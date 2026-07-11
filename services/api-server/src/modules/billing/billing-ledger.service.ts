import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type { BillingLedgerEntry } from "./billing-records.js";

export function appendBillingLedgerEntry(
  entry: Omit<BillingLedgerEntry, "id" | "createdAt">,
) {
  const store = getStoreSnapshot();
  const existing = entry.idempotencyKey
    ? findBillingLedgerEntryByIdempotencyKey(entry.userId, entry.idempotencyKey)
    : null;
  if (existing) return existing;

  const record: BillingLedgerEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
  store.billingLedger = [...store.billingLedger, record];
  persistStoreSnapshot();
  return record;
}

export function findBillingLedgerEntryByIdempotencyKey(
  userId: string,
  idempotencyKey: string,
) {
  return getStoreSnapshot().billingLedger.find((entry) =>
    entry.userId === userId && entry.idempotencyKey === idempotencyKey
  ) ?? null;
}

export function listBillingLedger(userId: string) {
  return getStoreSnapshot().billingLedger
    .filter((entry) => entry.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
