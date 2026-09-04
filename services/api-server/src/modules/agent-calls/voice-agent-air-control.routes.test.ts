import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelephonyProvider } from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setCallRoomDataPublisherForTests } from
  "../call-links/call-room-worker.js";
import type { CallLinkWorkerRuntime } from
  "../call-links/call-link-worker-supervisor.js";
import {
  captureAgentCallEnv,
  clearAgentCallEnv,
  configureAirAgentExecutionEnv,
  createAuthorizedDraft,
  restoreAgentCallEnv,
} from "./agent-calls.test-support.js";
import {
  setAgentCallTelephonyRuntimeForTests,
  type AgentCallTelephonyRuntime,
} from
  "./agent-call-telephony-runtime.js";
import { setVoiceAgentRuntimeSupervisorForTests } from
  "./voice-agent-runtime-supervisor.js";

describe("Voice Agent Air participant and controls", () => {
  let previousAgentEnv: Record<string, string | undefined>;
  let previousVoiceEnv: Record<string, string | undefined>;
  let sendPhoneDtmf: ReturnType<typeof vi.fn<TelephonyProvider["sendPhoneDtmf"]>>;
  let hangupPhoneCall: ReturnType<typeof vi.fn<TelephonyProvider["hangupPhoneCall"]>>;

  beforeEach(() => {
    previousAgentEnv = captureAgentCallEnv();
    previousVoiceEnv = Object.fromEntries(
      voiceEnvKeys.map((key) => [key, process.env[key]]),
    );
    clearAgentCallEnv();
    configureAirAgentExecutionEnv();
    resetStore();
    sendPhoneDtmf = vi.fn<TelephonyProvider["sendPhoneDtmf"]>(
      async (request) => controlSuccess(request, "active", "dtmf"),
    );
    hangupPhoneCall = vi.fn<TelephonyProvider["hangupPhoneCall"]>(
      async (request) => controlSuccess(request, "ending", "hangup"),
    );
    setAgentCallTelephonyRuntimeForTests(airRuntime(
      sendPhoneDtmf,
      hangupPhoneCall,
    ));
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    });
    setVoiceAgentRuntimeSupervisorForTests(new BoundRuntime());
  });

  afterEach(() => {
    setAgentCallTelephonyRuntimeForTests(null);
    setCallRoomDataPublisherForTests(null);
    setVoiceAgentRuntimeSupervisorForTests(null);
    restoreAgentCallEnv(previousAgentEnv);
    restoreEnv(previousVoiceEnv);
  });

  it("binds Air and executes DTMF and hangup exactly once", async () => {
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app, true);
    const started = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/start`,
      payload: { consentPromptVersion: "cn-agent-v1" },
    });
    const claimed = await app.inject({
      method: "POST",
      url: "/internal/ai-calling-agent/drafts/claims",
      headers: internalHeaders,
      payload: { workerId: "air-worker-1", limit: 1 },
    });
    expect(started.statusCode).toBe(200);
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().claims).toHaveLength(1);
    configureVoiceRuntimeEnv();
    const claim = claimed.json().claims[0] as {
      workerId: string;
      leaseToken: string;
    };
    await app.inject({
      method: "POST",
      url: `/internal/ai-calling-agent/drafts/${draftId}/prepare-runtime`,
      headers: {
        ...internalHeaders,
        "x-agent-worker-id": claim.workerId,
        "x-agent-call-lease-token": claim.leaseToken,
      },
    });
    const draft = getStoreSnapshot().agentCallDrafts.find(
      (item) => item.id === draftId,
    )!;
    const snapshot = await app.inject({
      method: "POST",
      url: `/internal/voice-agent/calls/${draft.callId}/runtime-snapshot`,
      headers: internalHeaders,
      payload: {
        ticket: "signed-ticket",
        participantIdentity: "voice-agent-worker-1",
        workerId: "voice-worker-1",
        jobId: "voice-job-1",
      },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({
      telephonyProvider: "air780_volte",
      calleeParticipantIdentity: `${draft.callId}:guest:air:air-001`,
      airDeviceBinding: {
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 1,
      },
    });
    expect(snapshot.json()).not.toHaveProperty("sipParticipantIdentity");

    await app.inject({
      method: "POST",
      url: `/internal/ai-calling-agent/drafts/${draftId}/runtime-events`,
      headers: internalHeaders,
      payload: {
        ticket: "signed-ticket",
        eventId: "ivr-event-1",
        event: "ivr_detected",
        amdCategory: "machine-ivr",
      },
    });
    const dtmfRequest = {
      method: "POST" as const,
      url: `/internal/ai-calling-agent/drafts/${draftId}/tools/send_dtmf/authorize`,
      headers: internalHeaders,
      payload: {
        ticket: "signed-ticket",
        idempotencyKey: "voice-tool-dtmf-1",
        toolCallId: "tool-call-dtmf-1",
        arguments: { digit: "5", reason: "IVR asked" },
      },
    };
    const dtmf = await app.inject(dtmfRequest);
    const dtmfReplay = await app.inject(dtmfRequest);
    expect(dtmf.statusCode).toBe(200);
    expect(dtmf.json()).toMatchObject({
      authorized: true,
      executionMode: "provider_api",
      providerStatus: "succeeded",
    });
    expect(dtmfReplay.statusCode).toBe(200);
    expect(sendPhoneDtmf).toHaveBeenCalledTimes(1);

    const cancelled = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/cancel`,
      payload: { reason: "user_cancelled" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      draft: { status: "cancelled" },
      hangup: { status: "accepted" },
    });
    await app.close();

    expect(hangupPhoneCall).toHaveBeenCalledTimes(1);
    expect(getStoreSnapshot().providerOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationType: "phone_dtmf" }),
      expect.objectContaining({ operationType: "phone_hangup" }),
    ]));
    expect(getStoreSnapshot().providerOperations).not.toContainEqual(
      expect.objectContaining({ operationType: "sip_hangup" }),
    );
  });
});

class BoundRuntime implements CallLinkWorkerRuntime {
  private claim: ReturnType<BoundRuntime["ticket"]> | null = null;

  async ensure(callId: string) {
    if (this.claim?.callId === callId) return;
    const now = new Date().toISOString();
    this.claim = this.ticket(callId);
    getStoreSnapshot().workerDispatches.push({
      id: `dispatch-${callId}`,
      callId,
      sessionId: callId,
      roomName: `call_${callId}`,
      provider: "livekit_dispatch",
      agentName: "voice-agent-runtime",
      status: "ready",
      generation: 1,
      version: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now,
      updatedAt: now,
      readyAt: now,
    });
  }
  verifyTicket(ticket: string) {
    return ticket === "signed-ticket" ? this.claim : null;
  }
  markReady() {}
  stop() {}
  shutdown() {}

  private ticket(callId: string) {
    const now = Math.floor(Date.now() / 1_000);
    return {
      v: 1 as const,
      callId,
      sessionId: callId,
      roomName: `call_${callId}`,
      agentName: "voice-agent-runtime",
      generation: 1,
      nonce: "test-nonce",
      iat: now,
      exp: now + 300,
    };
  }
}

function airRuntime(
  sendPhoneDtmf: TelephonyProvider["sendPhoneDtmf"],
  hangupPhoneCall: TelephonyProvider["hangupPhoneCall"],
): AgentCallTelephonyRuntime {
  const binding = {
    providerCallId: "air-call-1",
    participantIdentity: "",
    callGeneration: 1,
    deviceLease: { deviceId: "air-001", leaseId: "lease-1", fencingToken: 1 },
  };
  const unsupported = async () => ({
    ok: false as const,
    provider: "air780_volte" as const,
    errorClass: "unavailable" as const,
    retryable: false,
    reconciliationRequired: false,
  });
  return {
    provider: "air780_volte" as const,
    adapter: {
      placePhoneCall: async (request: Parameters<TelephonyProvider["placePhoneCall"]>[0]) => ({
        ok: true as const,
        provider: "air780_volte" as const,
        externalResourceId: "air-call-1",
        capabilities: ["phone_outbound"],
        result: {
          communicationSessionId: request.sessionId,
          providerCallId: "air-call-1",
          participantIdentity: request.payload.participantIdentity,
          state: "dialing" as const,
        },
      }),
      sendPhoneDtmf,
      hangupPhoneCall,
      reconcilePhoneCall: unsupported,
    },
    timeoutMs: 1_000,
    buildPayload: ({ call, draft }) => ({
      communicationSessionId: call.sessionId,
      transport: "air780_volte" as const,
      callGeneration: 1,
      mediaPolicy: "agent_monitored" as const,
      roomName: call.roomName,
      phoneNumberReference: draft.targetPhone,
      participantIdentity: `${call.sessionId}:guest:air:air-001`,
      deviceLease: binding.deviceLease,
    }),
    resolveParticipantBinding: ({ call }) => ({
      ...binding,
      participantIdentity: `${call.sessionId}:guest:air:air-001`,
    }),
    resolveControlPayload: ({ call }) => ({
      communicationSessionId: call.sessionId,
      providerCallId: binding.providerCallId,
      callGeneration: binding.callGeneration,
      deviceLease: binding.deviceLease,
    }),
  };
}

function controlSuccess(
  request: Parameters<TelephonyProvider["hangupPhoneCall"]>[0],
  state: "active" | "ending",
  capability: "dtmf" | "hangup",
) {
  return {
    ok: true as const,
    provider: "air780_volte" as const,
    externalResourceId: request.payload.providerCallId,
    capabilities: [capability],
    result: {
      communicationSessionId: request.sessionId,
      providerCallId: request.payload.providerCallId,
      state,
    },
  };
}

function configureVoiceRuntimeEnv() {
  process.env.VOICE_AGENT_ENABLED = "true";
  process.env.VOICE_AGENT_AUTONOMOUS_ENABLED = "true";
  process.env.VOICE_AGENT_RUNTIME_PROVIDER = "livekit_dispatch";
  process.env.VOICE_AGENT_DISPATCH_TICKET_SECRET = "v".repeat(32);
  process.env.VOICE_AGENT_STT_MODEL = "stt/model";
  process.env.VOICE_AGENT_LLM_MODEL = "llm/model";
  process.env.VOICE_AGENT_TTS_MODEL = "tts/model";
  process.env.VOICE_AGENT_TTS_VOICE = "voice";
  process.env.VOICE_AGENT_DISCLOSURE_TEXT_ZH = "AI disclosure";
  process.env.VOICE_AGENT_DISCLOSURE_TEXT_EN = "AI disclosure";
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "key";
  process.env.LIVEKIT_API_SECRET = "secret";
}

function resetStore() {
  const store = getStoreSnapshot();
  store.agentCallDrafts = [];
  store.sessions = [];
  store.usageBalances = {};
  store.usagePlanCodes = {};
  store.usageHolds = [];
  store.billingLedger = [];
  store.providerOperations = [];
  store.agentRuns = [];
  store.agentSteps = [];
  store.agentToolExecutions = [];
  store.workerDispatches = [];
  store.workerCapacityReservations = [];
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of voiceEnvKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const internalHeaders = { authorization: "Bearer internal-secret-for-agent" };
const voiceEnvKeys = [
  "VOICE_AGENT_ENABLED", "VOICE_AGENT_AUTONOMOUS_ENABLED",
  "VOICE_AGENT_RUNTIME_PROVIDER", "VOICE_AGENT_DISPATCH_TICKET_SECRET",
  "VOICE_AGENT_STT_MODEL", "VOICE_AGENT_LLM_MODEL", "VOICE_AGENT_TTS_MODEL",
  "VOICE_AGENT_TTS_VOICE", "VOICE_AGENT_DISCLOSURE_TEXT_ZH",
  "VOICE_AGENT_DISCLOSURE_TEXT_EN", "CALL_ROOM_PROVIDER", "LIVEKIT_URL",
  "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
];
