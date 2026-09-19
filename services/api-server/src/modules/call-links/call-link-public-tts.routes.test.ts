import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { savePublicModelConfiguration } from
  "../models/public-model-config-store.js";
import {
  body,
  installConfigurationFixture,
  secret,
} from "../sessions/public-model-configuration.test-support.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";

installConfigurationFixture();

const internalSecret = "internal-call-link-worker-test-secret";
const workerSecret = "worker-tts-material-access-secret";
const ticket = "synthetic.worker.ticket";
let activeCallId = "";

describe("Call Link public Tencent TTS Worker material", () => {
  let previous: Record<string, string | undefined>;

  beforeEach(async () => {
    previous = captureEnv();
    configureEnv();
    await configureTencentTts();
    resetStore();
    setCallLinkWorkerSupervisorForTests(new VerifiedWorkerRuntime());
  });

  afterEach(() => {
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previous);
  });

  it("binds the configured Tencent snapshot at create, returns material only to the active dispatch, and journals a single attempt lifecycle", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    markActiveWorker(callId);

    const material = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-material`,
      headers: headers(),
      payload: binding(),
    });
    const first = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-attempt`,
      headers: headers(),
      payload: { ...binding(), event: attempt(callId, "dispatching") },
    });
    const final = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-attempt`,
      headers: headers(),
      payload: {
        ...binding(),
        event: {
          ...attempt(callId, "confirmed"),
          metadata: {
            requestId: "provider-request-1",
            usage: { billedCharacters: 12 },
          },
        },
      },
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-attempt`,
      headers: headers(),
      payload: { ...binding(), event: attempt(callId, "dispatching") },
    });
    await app.close();

    expect(created.statusCode).toBe(200);
    expect(material.statusCode).toBe(200);
    expect(material.json()).toMatchObject({
      callId,
      sessionId: callId,
      generation: 1,
      workerId: "worker-1",
      jobId: "job-1",
      profile: {
        providerId: "tencent",
        protocol: "tencent_tts_ws",
        modelId: "service:tencent_tts_ws",
        voice: "101001",
      },
    });
    expect(material.json().credentials).toMatchObject({ secretId: "SYNTHETIC_ID" });
    expect(first.statusCode).toBe(200);
    expect(final.statusCode).toBe(200);
    expect(final.json()).toMatchObject({
      costStatus: "unknown",
      event: { state: "confirmed", modelId: "service:tencent_tts_ws" },
    });
    expect(duplicate.statusCode).toBe(409);
    const stored = getStoreSnapshot().sessions.find((session) => session.id === callId)!;
    expect(JSON.stringify(stored.callLink?.publicTts)).not.toContain(secret);
    expect(stored.callLink?.publicTtsAttempts).toHaveLength(1);
    expect(stored.callLink?.publicTtsAttempts?.[0]?.event).toMatchObject({
      state: "confirmed",
      metadata: { usage: { billedCharacters: 12 } },
    });
    expect(getStoreSnapshot().billingLedger).toHaveLength(0);
  });

  it("does not disclose material for a wrong credential or after the bound model configuration changes", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    markActiveWorker(callId);
    const denied = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-material`,
      headers: { ...headers(), "x-wujie-worker-tts-credential": "wrong" },
      payload: binding(),
    });
    await configureTencentTts(2, "101002");
    const stale = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-material`,
      headers: headers(),
      payload: binding(),
    });
    const roomToken = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-token`,
      payload: { participantRole: "host", participantName: "Host" },
    });
    await app.close();

    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain(secret);
    expect(stale.statusCode).toBe(409);
    expect(stale.body).not.toContain(secret);
    expect(roomToken.statusCode).toBe(503);
    expect(roomToken.json().error.code).toBe(
      "call_link_public_model_runtime_unavailable",
    );
  });

  it("accepts a known terminal attempt after call end without reopening material or customer settlement", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    markActiveWorker(callId);
    const dispatched = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-attempt`,
      headers: headers(),
      payload: { ...binding(), event: attempt(callId, "dispatching") },
    });
    getStoreSnapshot().sessions.find((session) => session.id === callId)!.status = "ended";
    await configureTencentTts(2, "101002");
    const terminal = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-tts-attempt`,
      headers: headers(),
      payload: {
        ...binding(),
        event: {
          ...attempt(callId, "confirmed"),
          metadata: { usage: { billedCharacters: 12 } },
        },
      },
    });
    await app.close();

    expect(dispatched.statusCode).toBe(200);
    expect(terminal.statusCode).toBe(200);
    expect(getStoreSnapshot().sessions.find((session) => session.id === callId)
      ?.callLink?.publicTtsAttempts?.[0]?.event.state).toBe("confirmed");
    expect(getStoreSnapshot().billingLedger).toHaveLength(0);
  });
});

async function build() {
  return buildApp({
    publicRealtimeAuthority: {
      timeoutMs: 1000,
      configurationCapability: () => ({
        status: "qualified",
        qualifiedLanguagePairs: [{ source: "zh", target: "en" }],
        automaticLanguage: false,
        automaticReverse: false,
      }),
      resolveVerifiedEvidence: async () => {
        throw new Error("not used by Call Link TTS material test");
      },
    },
    callLinkWorkerTtsCredentialAccess: { secret: workerSecret },
  });
}

async function configureTencentTts(expectedRevision = 1, voice = "101001") {
  const update = body(expectedRevision);
  Object.assign(update.components.tts, {
    vendor: "tencent",
    protocol: "tencent_tts_ws",
    authKind: "tencent_secret",
    endpoint: "wss://tts.cloud.tencent.com/stream_wsv2",
    appId: "10001",
    voice,
    modelId: "",
    sampleRate: 16000,
  });
  update.credentials.tts = { secretId: "SYNTHETIC_ID", secretKey: secret };
  await savePublicModelConfiguration(update);
}

function markActiveWorker(callId: string) {
  activeCallId = callId;
  const session = getStoreSnapshot().sessions.find((item) => item.id === callId)!;
  session.callLegs = [
    leg(callId, "host", "host"),
    leg(callId, "guest", "guest"),
    leg(callId, "worker", "call-1:worker:one"),
  ];
  getStoreSnapshot().workerDispatches = [{
    id: "dispatch-1",
    callId,
    sessionId: callId,
    roomName: `call_${callId}`,
    provider: "livekit_dispatch",
    agentName: "translation-runtime",
    status: "ready",
    generation: 1,
    version: 1,
    workerId: "worker-1",
    jobId: "job-1",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }];
}

function leg(callId: string, role: "host" | "guest" | "worker", identity: string) {
  return {
    id: identity,
    participantIdentity: identity,
    participantRole: role,
    joinType: role === "worker" ? "worker" as const : role === "host" ? "app" as const : "web" as const,
    status: "active" as const,
    joinedAt: new Date().toISOString(),
  };
}

function binding() {
  return {
    ticket,
    participantIdentity: "call-1:worker:one",
    workerId: "worker-1",
    jobId: "job-1",
  };
}

function attempt(callId: string, state: "dispatching" | "confirmed") {
  return {
    callId,
    sessionId: callId,
    attemptId: "attempt-1",
    segmentId: "segment-1",
    revision: 1,
    providerId: "tencent",
    modelId: "service:tencent_tts_ws",
    state,
  };
}

function headers() {
  return {
    authorization: `Bearer ${internalSecret}`,
    "x-wujie-worker-tts-credential": workerSecret,
  };
}

class VerifiedWorkerRuntime implements CallLinkWorkerRuntime {
  async ensure() {}
  markReady() {}
  stop() {}
  shutdown() {}
  verifyTicket(value: string) {
    if (value !== ticket) return null;
    return {
      v: 1 as const,
      callId: activeCallId,
      sessionId: activeCallId,
      roomName: `call_${activeCallId}`,
      agentName: "translation-runtime",
      generation: 1,
      nonce: "nonce-1",
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 60,
    };
  }
}

function configureEnv() {
  process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "runtime-test";
  process.env.CALL_LINK_1_0_COMPATIBILITY_ENABLED = "true";
  process.env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID = "runtime-test";
  process.env.CALL_LINK_1_0_COMPATIBILITY_PROFILE = "call_link_only";
  process.env.CALL_PROVIDER_POLICY = "call_link_only";
  process.env.CALL_LINK_PUBLIC_TTS_ENABLED = "true";
  process.env.INTERNAL_API_SECRET = internalSecret;
  process.env.API_TEST_AUTO_ACCOUNT = "true";
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.workerDispatches = [];
  store.workerCapacityReservations = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
}

const keys = [
  "API_RESULT_SYNC_DEPLOYMENT_ID",
  "CALL_LINK_1_0_COMPATIBILITY_ENABLED",
  "CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID",
  "CALL_LINK_1_0_COMPATIBILITY_PROFILE",
  "CALL_PROVIDER_POLICY",
  "CALL_LINK_PUBLIC_TTS_ENABLED",
  "INTERNAL_API_SECRET",
  "API_TEST_AUTO_ACCOUNT",
];

function captureEnv() {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}
