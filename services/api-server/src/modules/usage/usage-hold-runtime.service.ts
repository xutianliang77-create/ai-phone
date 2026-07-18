import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { activePlanForUser } from "../plans/plans-runtime.service.js";
import {
  createUsageHold as createLegacyUsageHold,
  consumeSeconds as consumeLegacySeconds,
  getUsageBalance as getLegacyUsageBalance,
  refundSeconds as refundLegacySeconds,
  releaseUsageHold as releaseLegacyUsageHold,
  settleUsageHold as settleLegacyUsageHold,
} from "./usage.service.js";

export async function createUsageHold(
  userId: string,
  seconds: number,
  options: {
    sessionId: string;
    idempotencyKey: string;
    note?: string;
    ttlSeconds?: number;
  },
) {
  const runtime = getRepositoryRuntime();
  const plan = await activePlanForUser(userId);
  if (runtime.driver !== "postgres") {
    return createLegacyUsageHold(userId, seconds, plan, options);
  }
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: options.sessionId },
    async (fence) => {
      const requestHash = repositoryRequestHash({ userId, seconds, ...options });
      const commandId = repositoryCommandId({
        aggregateId: options.sessionId,
        operation: "usage-hold-create",
        version: 1,
        requestHash,
      });
      return runtime.postgres.usageHolds.create({
        sessionId: options.sessionId,
        userId,
        plan,
        seconds,
        idempotencyKey: options.idempotencyKey,
        note: options.note,
        ttlSeconds: options.ttlSeconds,
        commandId,
        commandType: "usage_hold.create",
        requestHash,
        fence,
      });
    },
  );
}

export async function releaseUsageHold(userId: string, sessionId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return releaseLegacyUsageHold(userId, sessionId);
  }
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    async (fence) => {
      const requestHash = repositoryRequestHash({ userId, sessionId });
      const commandId = repositoryCommandId({
        aggregateId: sessionId,
        operation: "usage-hold-release",
        version: 1,
        requestHash,
      });
      const result = await runtime.postgres.usageHolds.release({
        sessionId,
        userId,
        plan: await activePlanForUser(userId),
        commandId,
        commandType: "usage_hold.release",
        requestHash,
        fence,
      });
      return result.status === "released" ? result.hold ?? null : null;
    },
  );
}

export async function settleUsageHold(
  userId: string,
  sessionId: string,
  seconds: number,
) {
  const runtime = getRepositoryRuntime();
  const plan = await activePlanForUser(userId);
  if (runtime.driver !== "postgres") {
    consumeLegacySeconds(userId, seconds, plan, {
      note: "agent_call_usage",
      sessionId,
      idempotencyKey: `settle:${sessionId}`,
    });
    return settleLegacyUsageHold(userId, sessionId, seconds);
  }
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    async (fence) => {
      const requestHash = repositoryRequestHash({ userId, sessionId, seconds });
      return runtime.postgres.usageLedger.settleSession({
        userId,
        sessionId,
        plan,
        seconds,
        idempotencyKey: `settle:${sessionId}`,
        note: "agent_call_usage",
        commandId: repositoryCommandId({
          aggregateId: sessionId,
          operation: "usage-hold-settle",
          version: 1,
          requestHash,
        }),
        commandType: "usage_hold.settle",
        requestHash,
        fence,
      });
    },
  );
}

export async function getUsageBalance(userId: string) {
  const runtime = getRepositoryRuntime();
  const plan = await activePlanForUser(userId);
  if (runtime.driver !== "postgres") return getLegacyUsageBalance(userId, plan);
  const balance = await runtime.postgres.usageQueries.balance(userId);
  return balance ?? {
    userId,
    planCode: plan.code,
    monthlySeconds: plan.monthlySeconds,
    remainingSeconds: plan.monthlySeconds,
    heldSeconds: 0,
    availableSeconds: plan.monthlySeconds,
  };
}

export async function refundUsage(
  userId: string,
  sessionId: string,
  seconds: number,
  note: string,
) {
  const runtime = getRepositoryRuntime();
  const plan = await activePlanForUser(userId);
  if (runtime.driver !== "postgres") {
    const result = refundLegacySeconds(userId, seconds, plan, {
      sessionId,
      idempotencyKey: `refund:${sessionId}`,
      note,
    });
    releaseLegacyUsageHold(userId, sessionId);
    return result;
  }
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    async (fence) => {
      const requestHash = repositoryRequestHash({ userId, sessionId, seconds, note });
      return runtime.postgres.usageLedger.refundSession({
        userId,
        sessionId,
        plan,
        seconds,
        idempotencyKey: `refund:${sessionId}`,
        note,
        commandId: repositoryCommandId({
          aggregateId: sessionId,
          operation: "usage-refund",
          version: 1,
          requestHash,
        }),
        commandType: "usage.refund",
        requestHash,
        fence,
      });
    },
  );
}
