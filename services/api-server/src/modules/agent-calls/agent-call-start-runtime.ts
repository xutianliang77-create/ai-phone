import { createHash } from "node:crypto";
import type { StartAiCallingAgentCallRequest } from "@translation/contracts";
import { stableDomainId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  createUsageHold,
  releaseUsageHold,
} from "../usage/usage-hold-runtime.service.js";
import { AGENT_CALL_MINIMUM_START_SECONDS } from
  "./agent-call-usage-readiness.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import { evaluateAgentCallStartPolicy } from "./agent-call-gray-policy.js";
import {
  cleanText,
  isStartedStatus,
} from "./agent-call-repository-helpers.js";
import {
  autonomousAgentPolicyRequired,
  evaluateAutonomousAgentPolicy,
} from "./autonomous-agent-policy.js";
import {
  findAgentCallDraft,
  listAgentCallDrafts,
  mutateAgentCallTask,
} from "./agent-calls-runtime.repository.js";
import {
  beginAgentRun,
  requestAgentToolExecution,
} from "./agent-orchestration-runtime.repository.js";
import { ensureAgentCallSession } from "./agent-call-session.js";
import { startAgentCallDraft as startLegacyAgentCallDraft } from
  "./agent-call-start.js";
import {
  agentCallDialToolName,
  configuredAgentCallProvider,
} from "./agent-call-provider-profile.js";

export async function startAgentCallDraft(
  userId: string,
  draftId: string,
  request: StartAiCallingAgentCallRequest,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return startLegacyAgentCallDraft(userId, draftId, request);
  }
  const prepared = await prepare(userId, draftId, request);
  if (prepared.status === "already_started" && prepared.draft.callId) {
    await ensureStartArtifacts(prepared.draft, prepared.draft.callId, {
      policyVersion: "agent-start-recovery-v1",
    });
    return prepared;
  }
  if (prepared.status !== "ready") return prepared;

  const hold = await createUsageHold(userId, AGENT_CALL_MINIMUM_START_SECONDS, {
    sessionId: prepared.callId,
    idempotencyKey: `hold:${prepared.callId}`,
    note: "agent_call_session_hold",
    ttlSeconds: 2 * 60 * 60,
  });
  if (hold.status !== "held") {
    return { status: "insufficient_balance" as const, draft: prepared.draft, usage: hold };
  }
  const session = await ensureAgentCallSession({
    callId: prepared.callId,
    userId,
    createdAt: prepared.now,
  });
  if (!session) {
    await releaseUsageHold(userId, prepared.callId);
    return { status: "session_conflict" as const, draft: prepared.draft };
  }
  const queued = await mutateAgentCallTask(
    prepared.draft,
    "start",
    { callId: prepared.callId, request },
    (next) => queue(next, prepared.callId, prepared.now),
    "agent.task.queued",
    "queued",
    prepared.callId,
  );
  if (!hasTask(queued)) {
    const current = await findAgentCallDraft(userId, draftId);
    if (!current || current.callId !== prepared.callId || !isStartedStatus(current.status)) {
      await releaseUsageHold(userId, prepared.callId);
      return { status: "mutation_conflict" as const };
    }
    await ensureStartArtifacts(current, prepared.callId, prepared.autonomousPolicy);
    return { status: "already_started" as const, draft: current };
  }
  await ensureStartArtifacts(queued.task, prepared.callId, prepared.autonomousPolicy);
  return { status: "queued" as const, draft: queued.task };
}

async function prepare(
  userId: string,
  draftId: string,
  request: StartAiCallingAgentCallRequest,
) {
  const draft = await findAgentCallDraft(userId, draftId);
  if (!draft) return { status: "not_found" as const };
  if (isStartedStatus(draft.status)) return { status: "already_started" as const, draft };
  if (draft.status !== "authorized") return { status: "invalid_state" as const, draft };
  if (!cleanText(draft.targetPhone, 32)) return { status: "missing_target" as const, draft };
  const policy = evaluateAgentCallStartPolicy({
    userId,
    targetPhone: draft.targetPhone!,
    drafts: await listAgentCallDrafts(userId),
  });
  if (!policy.allowed) return { status: "policy_denied" as const, draft, policy };
  const autonomousPolicy = autonomousAgentPolicyRequired()
    ? evaluateAutonomousAgentPolicy({ userId, draft })
    : { allowed: true as const, policyVersion: "legacy-agent-call-v1" };
  if (!autonomousPolicy.allowed) {
    return { status: "policy_denied" as const, draft, policy: autonomousPolicy };
  }
  if (process.env.AGENT_CALL_GRAY_ENABLED === "true" &&
    (!draft.recipientDisclosureConfirmed || !draft.disclosurePromptVersion)) {
    return { status: "disclosure_required" as const, draft };
  }
  if (cleanText(request.consentPromptVersion, 80) &&
    request.consentPromptVersion !== draft.consentPromptVersion) {
    return { status: "invalid_consent" as const, draft };
  }
  return {
    status: "ready" as const,
    draft,
    callId: draft.callId ?? stableDomainId("agent_session", draft.id),
    now: new Date().toISOString(),
    autonomousPolicy,
  };
}

function queue(current: AgentCallRecord, callId: string, now: string) {
  if (isStartedStatus(current.status) && current.callId === callId) return current;
  if (current.status !== "authorized" || (current.callId && current.callId !== callId)) {
    return null;
  }
  current.status = "queued";
  current.callId = callId;
  current.executionProvider = configuredAgentCallProvider() ??
    (cleanText(process.env.PSTN_PROVIDER, 80) || "domestic_bridge");
  current.queuedAt = now;
  current.updatedAt = now;
  return current;
}

async function ensureStartArtifacts(
  draft: AgentCallRecord,
  callId: string,
  policy: { policyVersion: string },
) {
  const begun = await beginAgentRun({
    taskId: draft.id,
    sessionId: callId,
    mode: "autonomous",
    policyVersion: policy.policyVersion,
    modelProfileId: process.env.VOICE_AGENT_LLM_MODEL,
  });
  if (!hasRun(begun)) throw new Error("Agent run could not be created");
  const argumentsHash = createHash("sha256").update(JSON.stringify({
    callId,
    targetPhone: draft.targetPhone,
    scenario: draft.scenario,
  })).digest("hex");
  const tool = await requestAgentToolExecution({
    runId: begun.run.id,
    toolName: agentCallDialToolName,
    toolVersion: "v1",
    argumentsHash,
    riskLevel: "sensitive",
    approved: true,
    idempotencyKey: `agent-dial:${callId}`,
  });
  if (!hasExecution(tool)) throw new Error("Agent dial tool could not be created");
}

function hasTask(value: unknown): value is { task: AgentCallRecord } {
  return Boolean(value && typeof value === "object" && "task" in value &&
    (value as { task?: unknown }).task);
}

function hasRun(value: unknown): value is { run: { id: string } } {
  return Boolean(value && typeof value === "object" && "run" in value &&
    (value as { run?: { id?: unknown } }).run?.id);
}

function hasExecution(value: unknown): value is { execution: { id: string } } {
  return Boolean(value && typeof value === "object" && "execution" in value &&
    (value as { execution?: { id?: unknown } }).execution?.id);
}
