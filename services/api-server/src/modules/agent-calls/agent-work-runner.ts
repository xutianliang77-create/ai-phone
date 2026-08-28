import type { ApiEnv } from "../../config/env.js";
import { openAgentWorkArguments } from "./agent-work-arguments.js";
import {
  claimAgentWorks,
  convergeAgentWork,
  findClaimedAgentWorkExecutionPayload,
  listAgentWorkConvergenceCandidates,
  releaseClaimedAgentWorkForRetry,
  transitionClaimedAgentWork,
} from "./agent-work-runtime.repository.js";
import {
  AgentWorkToolGatewayClient,
  AgentWorkToolGatewayError,
} from "./agent-work-tool-gateway-client.js";
import type { AgentWorkRecord } from "./agent-work-record.js";

export interface AgentWorkRunnerResult {
  claimed: number;
  completed: number;
  cancelled: number;
  retried: number;
  failed: number;
  deferred: number;
  converged: number;
}

export function startAgentWorkRunner(input: {
  env: ApiEnv;
  onResult?: (result: AgentWorkRunnerResult) => void;
  onError: (error: unknown) => void;
}) {
  assertAgentWorkRunnerConfiguration(input.env);
  if (!input.env.voiceAgentWorkRunnerEnabled) return async () => {};
  const gateway = new AgentWorkToolGatewayClient({
    baseUrl: input.env.agentWorkToolGatewayUrl!,
    secret: input.env.agentWorkToolGatewaySecret!,
    timeoutMs: input.env.agentWorkToolGatewayTimeoutMs,
  });
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> = Promise.resolve();
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      active = runOnce(input.env, gateway)
        .then((result) => input.onResult?.(result))
        .catch(input.onError)
        .finally(schedule);
    }, input.env.agentWorkRunnerPollMs);
    timer.unref();
  };
  active = runOnce(input.env, gateway)
    .then((result) => input.onResult?.(result))
    .catch(input.onError)
    .finally(schedule);
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await active;
  };
}

export function assertAgentWorkRunnerConfiguration(env: ApiEnv) {
  if (!env.voiceAgentWorkRunnerEnabled) return;
  if (!env.voiceAgentBackgroundWorkEnabled ||
    !env.agentWorkToolGatewayUrl ||
    !env.agentWorkToolGatewaySecret) {
    throw new Error("Agent Work runner configuration is incomplete");
  }
  if (env.agentWorkRunnerLeaseSeconds * 1_000 <=
      env.agentWorkToolGatewayTimeoutMs + 5_000) {
    throw new Error(
      "Agent Work claim lease must exceed the tool timeout by 5 seconds",
    );
  }
}

async function runOnce(
  env: ApiEnv,
  gateway: AgentWorkToolGatewayClient,
): Promise<AgentWorkRunnerResult> {
  const result: AgentWorkRunnerResult = {
    claimed: 0,
    completed: 0,
    cancelled: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
    converged: 0,
  };
  const now = new Date();
  const candidates = await listAgentWorkConvergenceCandidates(now, 100);
  for (const work of candidates) {
    await convergeAgentWork({
      workId: work.workId,
      commandId: `agent-work-converge:${work.workId}:${now.getTime()}`,
      now,
    });
    result.converged += 1;
  }
  const works = await claimAgentWorks({
    owner: env.agentWorkRunnerOwner,
    limit: env.agentWorkRunnerConcurrency,
    leaseSeconds: env.agentWorkRunnerLeaseSeconds,
    ownerConcurrency: env.agentWorkRunnerConcurrency,
  });
  result.claimed = works.length;
  await Promise.all(works.map(async (work) => {
    const outcome = await processWork(
      env.agentWorkRunnerOwner,
      work,
      gateway,
      env.agentWorkToolGatewayTimeoutMs + 5_000,
    );
    result[outcome] += 1;
  }));
  return result;
}

async function processWork(
  owner: string,
  claimed: AgentWorkRecord,
  gateway: AgentWorkToolGatewayClient,
  minimumExecutionLeaseMs: number,
) {
  const claim = claimed.claim!;
  if (claimed.status === "cancelling") {
    try {
      await transitionClaimedAgentWork({
        workId: claimed.workId,
        claimId: claim.claimId,
        owner,
        expectedStatus: "cancelling",
        nextStatus: "cancelled",
        commandId: `agent-work-cancelled:${claim.claimId}`,
      });
    } catch (error) {
      if (isClaimConvergenceConflict(error)) return "deferred" as const;
      throw error;
    }
    return "cancelled" as const;
  }
  let currentStatus: "running" | "finalizing" = "running";
  try {
    if (executionDeadlineMs(claimed) - Date.now() <= minimumExecutionLeaseMs) {
      throw new AgentWorkToolGatewayError(
        "agent_work_claim_window_too_short",
        true,
      );
    }
    const payload = await findClaimedAgentWorkExecutionPayload({
      workId: claimed.workId,
      claimId: claim.claimId,
      owner,
    });
    const argumentsValue = openAgentWorkArguments({
      workId: claimed.workId,
      sessionId: claimed.sessionId,
      actorId: claimed.actorId,
      toolName: claimed.toolName,
    }, payload.sealedArguments, claimed.argumentsHash);
    const toolResult = await gateway.execute({
      work: claimed,
      arguments: argumentsValue,
    });
    await transitionClaimedAgentWork({
      workId: claimed.workId,
      claimId: claim.claimId,
      owner,
      expectedStatus: "running",
      nextStatus: "finalizing",
      commandId: `agent-work-finalizing:${claim.claimId}`,
    });
    currentStatus = "finalizing";
    await transitionClaimedAgentWork({
      workId: claimed.workId,
      claimId: claim.claimId,
      owner,
      expectedStatus: "finalizing",
      nextStatus: "completed",
      commandId: `agent-work-completed:${claim.claimId}`,
      resultSummary: toolResult,
    });
    return "completed" as const;
  } catch (error) {
    if (isClaimConvergenceConflict(error)) {
      return "deferred" as const;
    }
    const retryable = error instanceof AgentWorkToolGatewayError &&
      error.retryable;
    const code = safeErrorCode(error);
    if (retryable) {
      try {
        await releaseClaimedAgentWorkForRetry({
          workId: claimed.workId,
          claimId: claim.claimId,
          owner,
          commandId: `agent-work-retry:${claim.claimId}`,
          retryDelayMs: retryDelay(claimed.attempt),
          reasonCode: code,
        });
      } catch (transitionError) {
        if (isClaimConvergenceConflict(transitionError)) {
          return "deferred" as const;
        }
        throw transitionError;
      }
      return "retried" as const;
    }
    try {
      await transitionClaimedAgentWork({
        workId: claimed.workId,
        claimId: claim.claimId,
        owner,
        expectedStatus: currentStatus,
        nextStatus: "failed",
        commandId: `agent-work-failed:${claim.claimId}`,
        failureCode: code,
      });
    } catch (transitionError) {
      if (isClaimConvergenceConflict(transitionError)) {
        return "deferred" as const;
      }
      throw transitionError;
    }
    return "failed" as const;
  }
}

function executionDeadlineMs(work: AgentWorkRecord) {
  return Math.min(
    Date.parse(work.claim!.expiresAt),
    Date.parse(work.expiresAt),
    work.startedAt
      ? Date.parse(work.startedAt) + work.maxRuntimeMs
      : Number.POSITIVE_INFINITY,
    work.cancelDeadlineAt
      ? Date.parse(work.cancelDeadlineAt)
      : Number.POSITIVE_INFINITY,
  );
}

function isClaimConvergenceConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return [
    "work_claim_invalid",
    "work_status_conflict",
    "work_retry_status_conflict",
  ].includes(String(error.code));
}

function retryDelay(attempt: number) {
  return Math.min(300_000, 1_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 8));
}

function safeErrorCode(error: unknown) {
  const value = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : error instanceof Error ? error.name : "agent_work_failed";
  const normalized = value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return normalized || "agent_work_failed";
}
