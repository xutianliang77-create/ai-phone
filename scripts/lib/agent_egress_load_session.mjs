import {
  admissionRejectionAttestation,
  requestLoadJson as requestJson,
} from "./translation_room_load_http.mjs";
import { buildAgentEgressAttestation } from "./agent_egress_load_attestation.mjs";

export async function runAgentEgressLoadSession(options) {
  const nowMs = options.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  const deadlineMs = startedAtMs + options.durationMs;
  let draft;
  let activeDraft;
  let recording;
  let recordingStopped = false;
  let agentCancelled = false;
  try {
    await assertReadiness(options);
    draft = await createDraft(options);
    await authorizeDraft(options, draft.id);
    const queued = await startDraft(options, draft.id);
    activeDraft = await waitForActiveDraft(options, draft.id, queued);
    const sessionStartMs = nowMs() - startedAtMs;
    const consent = await waitForRecordingConsent(
      options,
      activeDraft.callId,
    );
    const recordingRequest = {
      idempotencyKey: `load-agent-egress:${options.sessionId}`,
      policyVersion: options.recordingPolicyVersion,
      retentionDays: 1,
      recordingType: "room_audio",
    };
    recording = await startRecording(options, activeDraft.callId, recordingRequest);
    const replay = await startRecording(options, activeDraft.callId, recordingRequest);
    assertRecordingReplay(recording, replay);
    recording = await waitForRecordingActive(
      options,
      activeDraft.callId,
      recording.id,
    );
    await holdActiveUntil(options, {
      deadlineMs,
      draftId: draft.id,
      callId: activeDraft.callId,
      recordingId: recording.id,
    });
    const stopStartedMs = nowMs();
    await stopRecording(options, activeDraft.callId, recording.id);
    recordingStopped = true;
    const completed = await waitForVerifiedRecording(
      options,
      activeDraft.callId,
      recording.id,
    );
    const finalLatencyMs = nowMs() - stopStartedMs;
    const cancelled = await cancelDraft(options, draft.id);
    agentCancelled = true;
    if (cancelled.status !== "cancelled") {
      throw new Error("Voice Agent did not acknowledge load-session cancellation");
    }
    return buildAgentEgressAttestation({
      options,
      draft,
      activeDraft,
      consent,
      recording: completed,
      artifact: verifiedArtifact(completed),
      sessionStartMs,
      finalLatencyMs,
      observedDurationMs: nowMs() - startedAtMs,
    });
  } catch (error) {
    const rejected = admissionRejectionAttestation(error, nowMs() - startedAtMs);
    if (rejected) return rejected;
    throw error;
  } finally {
    if (recording && activeDraft && !recordingStopped) {
      await stopRecording(options, activeDraft.callId, recording.id)
        .catch(() => undefined);
    }
    if (draft && !agentCancelled) {
      await cancelDraft(options, draft.id).catch(() => undefined);
    }
  }
}

async function assertReadiness(options) {
  const health = (await requestJson(options, `${options.apiBaseUrl}/health`)).body;
  if (health?.callRoomReadiness?.status !== "ready" ||
    health?.pstnReadiness?.status !== "ready" ||
    health?.pstnReadiness?.provider !== "livekit_sip" ||
    health?.voiceAgentRuntimeReadiness?.status !== "ready" ||
    health?.voiceAgentRuntimeReadiness?.provider !== "livekit_dispatch" ||
    health?.egressReadiness?.status !== "ready") {
    throw new Error("Staging Agent, LiveKit SIP, or Egress readiness is not ready");
  }
}

async function createDraft(options) {
  const response = await requestJson(options,
    `${options.apiBaseUrl}/ai-calling-agent/drafts`, {
      method: "POST",
      account: true,
      body: {
        scenario: "custom",
        objective: options.language === "en"
          ? "Keep the owned staging test call active until the endpoint gives its completion phrase."
          : "与自有自动应答测试端点保持通话，直到对方发出结束压测指令。",
        suggestedScript: options.language === "en"
          ? "Disclose the AI identity, request recording consent, then keep the call active."
          : "先披露AI身份，再询问录音同意；明确同意后保持通话。",
        targetName: "owned-auto-answer-staging",
        targetPhone: options.targetPhone,
        language: options.language,
      },
    });
  if (!response.body?.draft?.id || response.body.draft.status !== "draft") {
    throw new Error("Voice Agent staging draft was not created safely");
  }
  return response.body.draft;
}

async function authorizeDraft(options, draftId) {
  const response = await requestJson(options,
    `${options.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draftId)}/authorize`, {
      method: "POST",
      account: true,
      body: {
        userConfirmed: true,
        consentPromptVersion: options.consentPromptVersion,
        recipientDisclosureConfirmed: true,
        disclosurePromptVersion: options.disclosurePromptVersion,
        recordingRequested: true,
        recordingPolicyVersion: options.recordingPolicyVersion,
      },
    });
  const value = response.body?.draft;
  if (value?.status !== "authorized" || value.recordingRequested !== true ||
    value.recordingPolicyVersion !== options.recordingPolicyVersion) {
    throw new Error("Voice Agent recording authorization was not bound exactly");
  }
  return value;
}

async function startDraft(options, draftId) {
  return requestJson(options,
    `${options.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draftId)}/start`, {
      method: "POST",
      account: true,
      body: { consentPromptVersion: options.consentPromptVersion },
    }).then((result) => result.body?.draft);
}

async function waitForActiveDraft(options, draftId, initial) {
  let current = initial;
  const deadline = now(options) + options.agentStartTimeoutMs;
  while (current?.status !== "in_progress" && now(options) < deadline) {
    failOnAgentTerminal(current);
    await abortableDelay(options.statusPollMs, options);
    current = await getDraft(options, draftId);
  }
  if (current?.status !== "in_progress" || !current.callId || !current.providerCallId) {
    throw new Error(`Voice Agent call did not become active; status=${current?.status}`);
  }
  return current;
}

async function waitForRecordingConsent(options, callId) {
  const deadline = now(options) + options.consentTimeoutMs;
  while (now(options) < deadline) {
    const response = await requestJson(options,
      `${options.apiBaseUrl}/call-links/${encodeURIComponent(callId)}/recording-consents`,
      { account: true });
    const consent = response.body?.consents?.find((item) =>
      item.source === "voice_agent_runtime" && item.joinType === "sip"
    );
    if (consent?.status === "revoked") {
      throw new Error("Callee did not grant recording consent");
    }
    if (validRecordingConsent(consent, options)) return consent;
    await abortableDelay(options.statusPollMs, options);
  }
  throw new Error("Timed out waiting for bound callee recording consent");
}

function validRecordingConsent(consent, options) {
  return consent?.status === "granted" && consent.participantRole === "guest" &&
    consent.policyVersion === options.recordingPolicyVersion &&
    Number.isInteger(consent.generation) && consent.generation > 0 &&
    typeof consent.runtimeEventId === "string" && consent.runtimeEventId.length > 0 &&
    /^[a-f0-9]{64}$/.test(consent.evidenceHash ?? "") &&
    Date.parse(consent.expiresAt ?? "") > now(options);
}

function startRecording(options, callId, body) {
  return requestJson(options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(callId)}/recordings`,
    { method: "POST", account: true, body }).then((result) => result.body);
}

function assertRecordingReplay(first, replay) {
  if (!first?.id || first.id !== replay?.id || replay.replayed !== true ||
    first.externalRecordingId !== replay.externalRecordingId) {
    throw new Error("Egress start idempotency replay gate failed");
  }
}

async function waitForRecordingActive(options, callId, recordingId) {
  const deadline = now(options) + options.egressStartTimeoutMs;
  while (now(options) < deadline) {
    const recording = await getRecording(options, callId, recordingId);
    if (recording?.status === "active" && recording.externalRecordingId &&
      recording.providerOperationId) return recording;
    if (["completed", "failed"].includes(recording?.status)) {
      throw new Error(`Egress became terminal before load; status=${recording.status}`);
    }
    await abortableDelay(options.statusPollMs, options);
  }
  throw new Error("Timed out waiting for active Egress recording");
}

async function holdActiveUntil(options, state) {
  while (now(options) < state.deadlineMs) {
    const [draft, recording] = await Promise.all([
      getDraft(options, state.draftId),
      getRecording(options, state.callId, state.recordingId),
    ]);
    if (draft?.status !== "in_progress") {
      throw new Error(`Voice Agent ended during load; status=${draft?.status}`);
    }
    if (!recording || !["starting", "active"].includes(recording.status)) {
      throw new Error(`Egress ended during load; status=${recording?.status}`);
    }
    await abortableDelay(Math.min(
      options.statusPollMs,
      Math.max(0, state.deadlineMs - now(options)),
    ), options);
  }
}

function stopRecording(options, callId, recordingId) {
  return requestJson(options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(callId)}/recordings/${
      encodeURIComponent(recordingId)
    }/stop`, { method: "POST", account: true }).then((result) => result.body);
}

async function waitForVerifiedRecording(options, callId, recordingId) {
  const deadline = now(options) + options.artifactTimeoutMs;
  while (now(options) < deadline) {
    const recording = await getRecording(options, callId, recordingId);
    if (recording?.status === "failed") throw new Error("Egress recording failed");
    if (recording?.status === "completed" && verifiedArtifact(recording)) return recording;
    await abortableDelay(options.statusPollMs, options);
  }
  throw new Error("Timed out waiting for verified Egress artifact");
}

function verifiedArtifact(recording) {
  return recording?.artifacts?.find((artifact) =>
    artifact.status === "verified" && /^[a-f0-9]{64}$/.test(artifact.sha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(artifact.manifestSha256 ?? "") && artifact.verifiedAt
  );
}

async function getDraft(options, draftId) {
  return requestJson(options,
    `${options.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draftId)}`,
    { account: true }).then((result) => result.body?.draft);
}

async function getRecording(options, callId, recordingId) {
  const body = (await requestJson(options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(callId)}/recordings`,
    { account: true })).body;
  return body?.recordings?.find((item) => item.id === recordingId);
}

function cancelDraft(options, draftId) {
  return requestJson(options,
    `${options.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(draftId)}/cancel`, {
      method: "POST",
      account: true,
      body: { reason: "staging_load_session_completed" },
    }).then((result) => result.body?.draft);
}

function failOnAgentTerminal(draft) {
  if (["completed", "failed", "cancelled", "takeover_requested"]
    .includes(draft?.status)) {
    throw new Error(`Voice Agent became terminal before start; status=${draft.status}`);
  }
}

function now(options) { return (options.nowMs ?? Date.now)(); }

function abortableDelay(ms, options) {
  const sleep = options.sleep ?? ((delay) =>
    new Promise((resolve) => setTimeout(resolve, delay)));
  if (ms <= 0) return Promise.resolve();
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Agent Egress load session aborted");
  }
  if (!options.signal) return sleep(ms);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(
      options.signal.reason ?? new Error("Agent Egress load session aborted"),
    );
    options.signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(sleep(ms)).then(resolve, reject).finally(() =>
      options.signal.removeEventListener("abort", aborted));
  });
}
