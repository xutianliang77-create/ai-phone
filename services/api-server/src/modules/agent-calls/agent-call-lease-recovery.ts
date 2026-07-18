import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { updateProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import { releaseUsageHold } from "../usage/usage-hold-runtime.service.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import { mutateAgentCallTask } from "./agent-calls-runtime.repository.js";
import { recoverExpiredAgentCallLeases as recoverLegacy } from
  "./agent-call-lease.repository.js";
import {
  findActiveAgentRun,
  findAgentToolExecutionForTask,
  updateAgentRun,
  updateAgentToolExecution,
} from "./agent-orchestration-runtime.repository.js";

export async function recoverExpiredAgentCallLeases(now = new Date()) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return recoverLegacy(now);
  let recoveredCount = 0;
  let reconciliationExpiredCount = 0;
  const expired = await runtime.postgres.agentTasks.listExpiredLeases(now);
  for (const draft of expired) {
    const changed = await mutateAgentCallTask(
      draft,
      "lease-expired",
      { leaseExpiresAt: draft.workerLeaseExpiresAt },
      (next) => {
        if (next.status !== "dispatching" ||
          Date.parse(next.workerLeaseExpiresAt ?? "") > now.getTime()) return null;
        next.status = "reconciliation_required";
        next.failureReason = "dispatch_lease_expired_unknown";
        next.nextStep = "人工核对服务商记录；确认未拨号前不得重试。";
        next.workerLeaseExpiresAt = undefined;
        next.updatedAt = now.toISOString();
        return next;
      },
      "agent.task.reconciliation_required",
      "updated",
    );
    if (hasTask(changed)) {
      await markProvider(changed.task, "unknown", "dispatch_lease_expired_unknown", now);
      recoveredCount += 1;
    }
  }
  const cutoff = new Date(now.getTime() - reconciliationTimeoutSeconds() * 1_000);
  const stale = await runtime.postgres.agentTasks.listExpiredReconciliations(cutoff);
  for (const draft of stale) {
    const changed = await mutateAgentCallTask(
      draft,
      "reconciliation-timeout",
      { cutoff: cutoff.toISOString() },
      (next) => {
        if (next.status !== "reconciliation_required" ||
          Date.parse(next.updatedAt) > cutoff.getTime()) return null;
        next.status = "failed";
        next.failureReason = "provider_reconciliation_timeout";
        next.nextStep = "人工复核账单和服务商最终状态。";
        next.failedAt = now.toISOString();
        next.updatedAt = now.toISOString();
        return next;
      },
      "agent.task.failed",
      "updated",
    );
    if (!hasTask(changed)) continue;
    await markProvider(changed.task, "failed", "provider_reconciliation_timeout", now);
    if (changed.task.callId) await releaseUsageHold(changed.task.userId, changed.task.callId);
    await finishRunAndTool(changed.task, now);
    reconciliationExpiredCount += 1;
  }
  return { recoveredCount, reconciliationExpiredCount };
}

export function startAgentCallLeaseRecovery(input: {
  intervalSeconds: number;
  onResult?: (result: Awaited<ReturnType<typeof recoverExpiredAgentCallLeases>>) => void;
  onError?: (error: unknown) => void;
}) {
  const run = () => {
    void recoverExpiredAgentCallLeases().then(input.onResult).catch(input.onError);
  };
  const timer = setInterval(run, input.intervalSeconds * 1_000);
  timer.unref();
  return () => clearInterval(timer);
}

async function markProvider(
  draft: AgentCallRecord,
  status: "unknown" | "failed",
  errorClass: string,
  now: Date,
) {
  if (!draft.providerOperationId) return;
  await updateProviderOperation({
    operationId: draft.providerOperationId,
    status,
    errorClass,
    now,
  });
}

async function finishRunAndTool(draft: AgentCallRecord, now: Date) {
  const run = await findActiveAgentRun(draft.id, "autonomous");
  if (run) await updateAgentRun({
    runId: run.id,
    status: "failed",
    failureCode: draft.failureReason,
    now,
  });
  if (!draft.callId) return;
  const tool = await findAgentToolExecutionForTask(
    draft.id,
    `agent-dial:${draft.callId}`,
  );
  if (tool) await updateAgentToolExecution({
    executionId: tool.id,
    status: "failed",
    providerOperationId: draft.providerOperationId,
    resultSummary: draft.failureReason,
    now,
  });
}

function reconciliationTimeoutSeconds() {
  const value = Number(process.env.AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS ?? 7200);
  return Number.isInteger(value) && value >= 300 && value <= 86_400 ? value : 7200;
}

function hasTask(value: unknown): value is { task: AgentCallRecord } {
  return Boolean(value && typeof value === "object" && "task" in value &&
    (value as { task?: unknown }).task);
}
