import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { activePlanForUser } from "../plans/plans.service.js";
import {
  createUsageHold as createLegacyUsageHold,
  releaseUsageHold as releaseLegacyUsageHold,
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
  const plan = activePlanForUser(userId);
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
        plan: activePlanForUser(userId),
        commandId,
        commandType: "usage_hold.release",
        requestHash,
        fence,
      });
      return result.status === "released" ? result.hold ?? null : null;
    },
  );
}
