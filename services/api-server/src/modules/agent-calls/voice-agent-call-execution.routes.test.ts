import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelephonyProvider } from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setCallRoomDataPublisherForTests } from
  "../call-links/call-room-worker.js";
import type { CallLinkWorkerRuntime } from
  "../call-links/call-link-worker-supervisor.js";
import {
  configureAirAgentExecutionEnv,
  createAuthorizedDraft,
} from "./agent-calls.test-support.js";
import { setAgentCallTelephonyRuntimeForTests } from
  "./agent-call-telephony-runtime.js";
import { setVoiceAgentRuntimeSupervisorForTests } from
  "./voice-agent-runtime-supervisor.js";
describe("Voice Agent phone execution route", () => {
  let previousEnv: Record<string, string | undefined>;
  let placePhoneCall: ReturnType<typeof vi.fn<TelephonyProvider["placePhoneCall"]>>;
  let sendPhoneDtmf: ReturnType<typeof vi.fn<TelephonyProvider["sendPhoneDtmf"]>>;
  let hangupPhoneCall: ReturnType<typeof vi.fn<TelephonyProvider["hangupPhoneCall"]>>;
  beforeEach(() => {
    previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) delete process.env[key];
    configureAirAgentExecutionEnv();
    resetStore();
    placePhoneCall = vi.fn<TelephonyProvider["placePhoneCall"]>(
      async (request) => ({
        ok: true,
        provider: "air780_volte",
        externalOperationId: request.operationId,
        externalResourceId: "air-call-1",
        capabilities: ["phone_outbound"],
        result: {
          communicationSessionId: request.sessionId,
          providerCallId: "air-call-1",
          participantIdentity: request.payload.participantIdentity,
          state: "dialing",
          deviceId: "air-001",
        },
      }),
    );
    sendPhoneDtmf = vi.fn<TelephonyProvider["sendPhoneDtmf"]>(
      async (request) => controlSuccess(request, "active", "dtmf"),
    );
    hangupPhoneCall = vi.fn<TelephonyProvider["hangupPhoneCall"]>(
      async (request) => controlSuccess(request, "ending", "hangup"),
    );
    setAgentCallTelephonyRuntimeForTests({
      provider: "air780_volte",
      adapter: telephonyProvider(placePhoneCall, sendPhoneDtmf, hangupPhoneCall),
      timeoutMs: 1_000,
      buildPayload: ({ call, draft }) => ({
        communicationSessionId: call.sessionId,
        transport: "air780_volte",
        callGeneration: 1,
        mediaPolicy: "agent_monitored",
        roomName: call.roomName,
        phoneNumberReference: draft.targetPhone!,
        participantIdentity: `${call.sessionId}:guest:air:air-001`,
        deviceLease: {
          deviceId: "air-001",
          leaseId: "lease-1",
          fencingToken: 1,
        },
      }),
      resolveParticipantBinding: ({ call }) => ({
        providerCallId: "air-call-1",
        participantIdentity: `${call.sessionId}:guest:air:air-001`,
        callGeneration: 1,
        deviceLease: {
          deviceId: "air-001",
          leaseId: "lease-1",
          fencingToken: 1,
        },
      }),
      resolveControlPayload: ({ call }) => ({
        communicationSessionId: call.sessionId,
        providerCallId: "air-call-1",
        callGeneration: 1,
        deviceLease: {
          deviceId: "air-001",
          leaseId: "lease-1",
          fencingToken: 1,
        },
      }),
    });
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    });
    setVoiceAgentRuntimeSupervisorForTests(new ReadyRuntime());
  });

  afterEach(() => {
    setAgentCallTelephonyRuntimeForTests(null);
    setCallRoomDataPublisherForTests(null);
    setVoiceAgentRuntimeSupervisorForTests(null);
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it("dispatches Air through TelephonyProvider without SIP and replays once", async () => {
    const app = await buildApp();
    const { draftId, queued, claimed, claim } = await startAndClaim(app);
    const request = {
      method: "POST" as const,
      url: `/internal/ai-calling-agent/drafts/${draftId}/prepare-runtime`,
      headers: {
        authorization: "Bearer internal-secret-for-agent",
        "x-agent-worker-id": claim.workerId,
        "x-agent-call-lease-token": claim.leaseToken,
      },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    await app.close();

    expect(queued.statusCode).toBe(200);
    expect(claimed.statusCode).toBe(200);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({
      status: "in_progress",
      providerOperationStatus: "accepted",
      providerCallId: "air-call-1",
    });
    expect(replay.statusCode).toBe(202);
    expect(placePhoneCall).toHaveBeenCalledTimes(1);
    expect(placePhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        transport: "air780_volte",
        mediaPolicy: "agent_monitored",
        roomName: `call_${queued.json().draft.callId}`,
        deviceLease: expect.objectContaining({ fencingToken: 1 }),
      }),
    }));
    expect(getStoreSnapshot().providerOperations).toContainEqual(
      expect.objectContaining({
        provider: "air780_volte",
        operationType: "phone_outbound",
        status: "accepted",
      }),
    );
    expect(getStoreSnapshot().providerOperations).not.toContainEqual(
      expect.objectContaining({ operationType: "sip_outbound" }),
    );
  });

  it("serializes dial acceptance before runtime-failure hangup", async () => {
    const app = await buildApp();
    const { draftId, claim } = await startAndClaim(app, true);
    let signalDialStarted!: () => void;
    const dialStarted = new Promise<void>((resolve) => { signalDialStarted = resolve; });
    let releaseDial!: () => void;
    const dialBlocked = new Promise<void>((resolve) => { releaseDial = resolve; });
    const original = placePhoneCall.getMockImplementation()!;
    placePhoneCall.mockImplementationOnce(async (request) => {
      signalDialStarted();
      await dialBlocked;
      return original(request);
    });
    const preparing = app.inject({
      method: "POST",
      url: `/internal/ai-calling-agent/drafts/${draftId}/prepare-runtime`,
      headers: workerHeaders(claim),
    });
    await dialStarted;
    const hangingUp = app.inject({
      method: "POST",
      url: `/internal/ai-calling-agent/drafts/${draftId}/tools/hangup_call/execute`,
      headers: { authorization: "Bearer internal-secret-for-agent" },
      payload: { ticket: "signed-ticket", reason: "runtime_failed" },
    });
    const race = await Promise.race([hangingUp.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))]);
    releaseDial();
    const [prepared, hungUp] = await Promise.all([preparing, hangingUp]);
    await app.close();

    expect(race).toBe("waiting");
    expect(prepared.statusCode).toBe(202);
    expect(hungUp.statusCode).toBe(202);
    expect(hangupPhoneCall).toHaveBeenCalledTimes(1);
  });
});

class ReadyRuntime implements CallLinkWorkerRuntime {
  private claim: {
    v: 1;
    callId: string;
    sessionId: string;
    roomName: string;
    agentName: string;
    generation: number;
    nonce: string;
    iat: number;
    exp: number;
  } | null = null;

  async ensure(callId: string) {
    if (this.claim?.callId === callId) return;
    const now = new Date().toISOString();
    const nowSeconds = Math.floor(Date.now() / 1_000);
    this.claim = {
      v: 1,
      callId,
      sessionId: callId,
      roomName: `call_${callId}`,
      agentName: "voice-agent-runtime",
      generation: 1,
      nonce: "test-nonce",
      iat: nowSeconds,
      exp: nowSeconds + 300,
    };
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
}

function telephonyProvider(
  placePhoneCall: TelephonyProvider["placePhoneCall"],
  sendPhoneDtmf: TelephonyProvider["sendPhoneDtmf"],
  hangupPhoneCall: TelephonyProvider["hangupPhoneCall"],
): TelephonyProvider {
  const unsupported = async () => ({
    ok: false as const,
    provider: "air780_volte" as const,
    errorClass: "unavailable" as const,
    retryable: false,
    reconciliationRequired: false,
  });
  return {
    placePhoneCall,
    sendPhoneDtmf,
    hangupPhoneCall,
    reconcilePhoneCall: unsupported,
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

async function startAndClaim(app: Awaited<ReturnType<typeof buildApp>>, disclosure = false) {
  const draftId = await createAuthorizedDraft(app, disclosure);
  const queued = await app.inject({
    method: "POST", url: `/ai-calling-agent/drafts/${draftId}/start`,
    payload: { consentPromptVersion: "cn-agent-v1" },
  });
  const claimed = await app.inject({
    method: "POST", url: "/internal/ai-calling-agent/drafts/claims",
    headers: { authorization: "Bearer internal-secret-for-agent" },
    payload: { workerId: "air-worker-1", limit: 1 },
  });
  configureVoiceRuntimeEnv();
  const claim = claimed.json().claims[0] as
    { workerId: string; leaseToken: string };
  return { draftId, queued, claimed, claim };
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

function workerHeaders(claim: { workerId: string; leaseToken: string }) {
  return {
    authorization: "Bearer internal-secret-for-agent",
    "x-agent-worker-id": claim.workerId,
    "x-agent-call-lease-token": claim.leaseToken,
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
    externalOperationId: request.operationId,
    externalResourceId: request.payload.providerCallId,
    capabilities: [capability],
    result: {
      communicationSessionId: request.sessionId,
      providerCallId: request.payload.providerCallId,
      state,
      deviceId: request.payload.deviceLease?.deviceId,
    },
  };
}

const envKeys = [
  "AGENT_CALL_WORKER_ENABLED", "AGENT_CALL_PROVIDER_ADAPTER", "AGENT_CALL_WORKER_LEASE_SECONDS",
  "AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS", "PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED",
  "INTERNAL_API_SECRET", "PSTN_PROVIDER", "CALL_PROVIDER_POLICY", "VOICE_AGENT_ENABLED",
  "VOICE_AGENT_AUTONOMOUS_ENABLED", "VOICE_AGENT_RUNTIME_PROVIDER",
  "VOICE_AGENT_DISPATCH_TICKET_SECRET", "VOICE_AGENT_STT_MODEL", "VOICE_AGENT_LLM_MODEL",
  "VOICE_AGENT_TTS_MODEL", "VOICE_AGENT_TTS_VOICE", "VOICE_AGENT_DISCLOSURE_TEXT_ZH",
  "VOICE_AGENT_DISCLOSURE_TEXT_EN", "CALL_ROOM_PROVIDER", "LIVEKIT_URL", "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET", "LIVEKIT_SIP_OUTBOUND_TRUNK_ID", "API_STORAGE_DRIVER",
  "AIR_DEVICE_GATEWAY_BASE_URL", "AIR_DEVICE_GATEWAY_API_SECRET", "AIR_DEVICE_GATEWAY_TIMEOUT_MS",
];
