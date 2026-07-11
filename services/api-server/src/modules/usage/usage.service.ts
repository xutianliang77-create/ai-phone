import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import { activePlanForUser } from "../plans/plans.service.js";
import type { PlanCode } from "../plans/plans.service.js";
import {
  appendBillingLedgerEntry,
  findBillingLedgerEntryByIdempotencyKey,
} from "../billing/billing-ledger.service.js";
import type { UsageHoldRecord } from "./usage-hold-record.js";

interface UsagePlan {
  code: PlanCode;
  monthlySeconds: number;
}

interface ConsumeSecondsOptions {
  note?: string;
  sessionId?: string;
  idempotencyKey?: string;
}

interface RefundSecondsOptions {
  note?: string;
  sessionId?: string;
  idempotencyKey?: string;
}

interface UsageHoldOptions {
  note?: string;
  sessionId?: string;
  idempotencyKey?: string;
  ttlSeconds?: number;
}

const defaultHoldTtlSeconds = 2 * 60 * 60;

export function getUsageBalance(userId: string, plan = activePlanForUser(userId)) {
  const remainingSeconds = ensurePlanBalance(userId, plan);
  const heldSeconds = getHeldSeconds(userId);
  return {
    userId,
    planCode: plan.code,
    subscribed: plan.code !== "free",
    monthlySeconds: plan.monthlySeconds,
    remainingSeconds,
    heldSeconds,
    availableSeconds: Math.max(0, remainingSeconds - heldSeconds),
  };
}

export function getRemainingSeconds(userId: string, plan = activePlanForUser(userId)) {
  return getUsageBalance(userId, plan).remainingSeconds;
}

export function ensureQuota(
  userId: string,
  minimumSeconds: number,
  plan = activePlanForUser(userId),
) {
  return getUsageBalance(userId, plan).availableSeconds >= minimumSeconds;
}

export function createUsageHold(
  userId: string,
  seconds: number,
  plan = activePlanForUser(userId),
  options: UsageHoldOptions = {},
) {
  const holdSeconds = normalizeSeconds(seconds);
  const existing = options.idempotencyKey
    ? findUsageHoldByIdempotencyKey(userId, options.idempotencyKey)
    : null;
  if (existing) {
    return {
      status: "held" as const,
      hold: existing,
      balance: getUsageBalance(userId, plan),
    };
  }

  const balance = getUsageBalance(userId, plan);
  if (holdSeconds <= 0 || balance.availableSeconds < holdSeconds) {
    return {
      status: "insufficient" as const,
      balance,
      requiredSeconds: holdSeconds,
    };
  }

  const now = new Date();
  const store = getStoreSnapshot();
  const hold: UsageHoldRecord = {
    id: randomUUID(),
    userId,
    seconds: holdSeconds,
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + (options.ttlSeconds ?? defaultHoldTtlSeconds) * 1000,
    ).toISOString(),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.note ? { note: options.note } : {}),
  };
  store.usageHolds = [...store.usageHolds, hold];
  persistStoreSnapshot();
  return {
    status: "held" as const,
    hold,
    balance: getUsageBalance(userId, plan),
  };
}

export function settleUsageHold(
  userId: string,
  sessionId: string,
  settledSeconds: number,
) {
  const hold = findActiveUsageHoldBySessionId(userId, sessionId);
  if (!hold) return null;
  const now = new Date().toISOString();
  hold.status = "settled";
  hold.settledSeconds = normalizeSeconds(settledSeconds);
  hold.settledAt = now;
  hold.releasedAt = now;
  persistStoreSnapshot();
  return hold;
}

export function releaseUsageHold(userId: string, sessionId: string) {
  const hold = findActiveUsageHoldBySessionId(userId, sessionId);
  if (!hold) return null;
  hold.status = "released";
  hold.releasedAt = new Date().toISOString();
  persistStoreSnapshot();
  return hold;
}

export function getHeldSeconds(userId: string) {
  return activeUsageHolds(userId).reduce((sum, hold) => sum + hold.seconds, 0);
}

export function consumeSeconds(
  userId: string,
  seconds: number,
  plan = activePlanForUser(userId),
  options: ConsumeSecondsOptions = {},
) {
  if (
    options.idempotencyKey &&
    findBillingLedgerEntryByIdempotencyKey(userId, options.idempotencyKey)
  ) {
    return getRemainingSeconds(userId, plan);
  }

  const consumedSeconds = normalizeSeconds(seconds);
  const store = getStoreSnapshot();
  const before = getRemainingSeconds(userId, plan);
  const next = Math.max(0, before - consumedSeconds);
  store.usageBalances[userId] = next;
  store.usagePlanCodes[userId] = plan.code;
  persistStoreSnapshot();
  if (consumedSeconds > 0 && before !== next) {
    appendBillingLedgerEntry({
      userId,
      type: "usage",
      source: "system",
      deltaSeconds: next - before,
      balanceAfter: next,
      note: options.note ?? "realtime_session_usage",
      sessionId: options.sessionId,
      idempotencyKey: options.idempotencyKey,
    });
  }
  return next;
}

export function refundSeconds(
  userId: string,
  seconds: number,
  plan = activePlanForUser(userId),
  options: RefundSecondsOptions = {},
) {
  const refundedSeconds = normalizeSeconds(seconds);
  const existing = options.idempotencyKey
    ? findBillingLedgerEntryByIdempotencyKey(userId, options.idempotencyKey)
    : null;
  if (existing) {
    return {
      status: "refunded" as const,
      balance: getUsageBalance(userId, plan),
      ledger: existing,
      refundedSeconds: Math.max(0, existing.deltaSeconds),
    };
  }

  if (refundedSeconds <= 0) {
    return {
      status: "noop" as const,
      balance: getUsageBalance(userId, plan),
      refundedSeconds: 0,
    };
  }

  const store = getStoreSnapshot();
  const before = getRemainingSeconds(userId, plan);
  const next = before + refundedSeconds;
  store.usageBalances[userId] = next;
  store.usagePlanCodes[userId] = plan.code;
  persistStoreSnapshot();
  const ledger = appendBillingLedgerEntry({
    userId,
    type: "refund",
    source: "system",
    deltaSeconds: refundedSeconds,
    balanceAfter: next,
    note: options.note ?? "usage_refund",
    sessionId: options.sessionId,
    idempotencyKey: options.idempotencyKey,
  });
  return {
    status: "refunded" as const,
    balance: getUsageBalance(userId, plan),
    ledger,
    refundedSeconds,
  };
}

function ensurePlanBalance(userId: string, plan: UsagePlan) {
  const store = getStoreSnapshot();
  const recordedPlan = store.usagePlanCodes[userId];
  const existingBalance = store.usageBalances[userId];
  if (recordedPlan !== plan.code || typeof existingBalance !== "number") {
    store.usagePlanCodes[userId] = plan.code;
    store.usageBalances[userId] = plan.monthlySeconds;
    persistStoreSnapshot();
    return plan.monthlySeconds;
  }
  return existingBalance;
}

function activeUsageHolds(userId: string) {
  const nowMs = Date.now();
  return getStoreSnapshot().usageHolds.filter((hold) =>
    hold.userId === userId &&
    hold.status === "active" &&
    Date.parse(hold.expiresAt) > nowMs
  );
}

function findUsageHoldByIdempotencyKey(
  userId: string,
  idempotencyKey: string,
) {
  return getStoreSnapshot().usageHolds.find((hold) =>
    hold.userId === userId && hold.idempotencyKey === idempotencyKey
  ) ?? null;
}

function findActiveUsageHoldBySessionId(userId: string, sessionId: string) {
  return activeUsageHolds(userId).find((hold) => hold.sessionId === sessionId) ?? null;
}

function normalizeSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}
