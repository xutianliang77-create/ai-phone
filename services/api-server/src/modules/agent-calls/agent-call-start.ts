import { createHash, randomUUID } from "node:crypto";
import type { StartAiCallingAgentCallRequest } from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
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
  beginAgentRun,
  requestAgentToolExecution,
} from "./agent-orchestration.repository.js";
import { ensureAgentCallSession } from "./agent-call-session.js";
import { tryAcquireAgentCallMutation } from "./agent-call-mutation-lock.js";

export async function startAgentCallDraft(
  userId: string,
  draftId: string,
  request: StartAiCallingAgentCallRequest,
) {
  const releaseMutation = tryAcquireAgentCallMutation(draftId);
  if (!releaseMutation) return { status: "mutation_conflict" as const };
  try {
    return await startAgentCallDraftUnlocked(userId, draftId, request);
  } finally {
    releaseMutation();
  }
}

async function startAgentCallDraftUnlocked(
  userId: string,
  draftId: string,
  request: StartAiCallingAgentCallRequest,
) {
  const prepared = runStoreTransaction(() => prepare(userId, draftId, request));
  if (prepared.status !== "ready") return prepared;
  const hold = await createUsageHold(userId, AGENT_CALL_MINIMUM_START_SECONDS, {
    sessionId: prepared.callId,
    idempotencyKey: `hold:${prepared.callId}`,
    note: "agent_call_session_hold",
    ttlSeconds: 2 * 60 * 60,
  });
  if (hold.status !== "held") {
    return {
      status: "insufficient_balance" as const,
      draft: prepared.draft,
      usage: hold,
    };
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
  const result = runStoreTransaction(() => commit(userId, draftId, prepared));
  if (result.status !== "queued" &&
    (result.status !== "already_started" ||
      result.draft.callId !== prepared.callId)) {
    await releaseUsageHold(userId, prepared.callId);
  }
  return result;
}

function prepare(
  userId: string,
  draftId: string,
  request: StartAiCallingAgentCallRequest,
) {
  const draft = findDraft(userId, draftId);
  if (!draft) return { status: "not_found" as const };
  if (isStartedStatus(draft.status)) {
    return { status: "already_started" as const, draft };
  }
  if (draft.status !== "authorized") {
    return { status: "invalid_state" as const, draft };
  }
  if (!cleanText(draft.targetPhone, 32)) {
    return { status: "missing_target" as const, draft };
  }
  const policy = evaluateAgentCallStartPolicy({
    userId,
    targetPhone: draft.targetPhone!,
    drafts: listDrafts(userId),
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
    draft: structuredClone(draft),
    callId: draft.callId ?? randomUUID(),
    now: new Date().toISOString(),
    autonomousPolicy,
  };
}

function commit(
  userId: string,
  draftId: string,
  prepared: Extract<ReturnType<typeof prepare>, { status: "ready" }>,
) {
  const draft = findDraft(userId, draftId);
  if (!draft) return { status: "not_found" as const };
  if (isStartedStatus(draft.status)) {
    return { status: "already_started" as const, draft };
  }
  if (draft.status !== "authorized") {
    return { status: "invalid_state" as const, draft };
  }
  draft.status = "queued";
  draft.callId = prepared.callId;
  draft.executionProvider = cleanText(
    process.env.PSTN_PROVIDER ?? process.env.AGENT_CALL_PROVIDER_ADAPTER,
    80,
  ) || "domestic_bridge";
  draft.queuedAt = prepared.now;
  draft.updatedAt = prepared.now;
  const run = beginAgentRun({
    taskId: draft.id,
    sessionId: prepared.callId,
    mode: "autonomous",
    policyVersion: prepared.autonomousPolicy.policyVersion,
    modelProfileId: process.env.VOICE_AGENT_LLM_MODEL,
  }).run;
  requestAgentToolExecution({
    runId: run.id,
    toolName: "place_sip_call",
    toolVersion: "v1",
    argumentsHash: createHash("sha256").update(JSON.stringify({
      callId: prepared.callId,
      targetPhone: draft.targetPhone,
      scenario: draft.scenario,
    })).digest("hex"),
    riskLevel: "sensitive",
    approved: true,
    idempotencyKey: `agent-dial:${prepared.callId}`,
  });
  persistStoreSnapshot();
  return { status: "queued" as const, draft };
}

function findDraft(userId: string, draftId: string) {
  return getStoreSnapshot().agentCallDrafts.find((draft) =>
    draft.userId === userId && draft.id === draftId
  ) ?? null;
}

function listDrafts(userId: string): AgentCallRecord[] {
  return getStoreSnapshot().agentCallDrafts.filter((draft) =>
    draft.userId === userId
  );
}
