import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAdapterResult } from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setLiveKitSipProviderFactoryForTests } from "./call-link-sip.routes.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";
import { registerCallLeg } from "./call-links.service.js";

describe("Call Link SIP outbound routes", () => {
  let previousEnv: Record<string, string | undefined>;
  let providerCall: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    providerCall = vi.fn(async () => providerSuccess());
    setLiveKitSipProviderFactoryForTests(() => ({
      createParticipant: providerCall,
    }));
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    });
    setCallLinkWorkerSupervisorForTests(new ReadyWorker());
  });

  afterEach(() => {
    setLiveKitSipProviderFactoryForTests(null);
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previousEnv);
  });

  it("requires the host to be connected before any provider call", async () => {
    const app = await buildApp();
    const callId = await createCallLink(app);

    const response = await dial(app, callId);
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("sip_host_not_connected");
    expect(providerCall).not.toHaveBeenCalled();
  });

  it("allows only one provider call for concurrent identical requests", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);

    const [first, second] = await Promise.all([
      dial(app, callId),
      dial(app, callId),
    ]);
    await app.close();

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(providerCall).toHaveBeenCalledTimes(1);
    expect([first.json().replayed, second.json().replayed].sort()).toEqual([
      false,
      true,
    ]);
    expect(first.json().operationId).toBe(second.json().operationId);
  });

  it("rejects a changed destination without redialing", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);

    const accepted = await dial(app, callId);
    const conflict = await dial(app, callId, "+8613900000000");
    await app.close();

    expect(accepted.statusCode).toBe(202);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("sip_outbound_operation_conflict");
    expect(providerCall).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain provider result pending for webhook reconciliation", async () => {
    providerCall.mockResolvedValueOnce({
      ok: false,
      provider: "livekit_sip",
      errorClass: "timeout",
      retryable: true,
      reconciliationRequired: true,
    });
    const app = await buildApp();
    const callId = await createHostReadyCall(app);

    const response = await dial(app, callId);
    await app.close();

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("unknown");
    expect(getStoreSnapshot().sessions[0]?.status).not.toBe("ended");
  });

  it("refunds and ends a call only after a definite pre-answer failure", async () => {
    providerCall.mockResolvedValueOnce({
      ok: false,
      provider: "livekit_sip",
      errorClass: "unavailable",
      retryable: false,
      reconciliationRequired: false,
    });
    const app = await buildApp();
    const callId = await createHostReadyCall(app);

    const response = await dial(app, callId);
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(getStoreSnapshot().sessions[0]).toMatchObject({
      status: "ended",
      consumedSeconds: 0,
    });
  });
});

class ReadyWorker implements CallLinkWorkerRuntime {
  async ensure() {}
  markReady() {}
  stop() {}
  shutdown() {}
}

async function createCallLink(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: "POST", url: "/call-links" });
  return response.json().callId as string;
}

async function createHostReadyCall(app: Awaited<ReturnType<typeof buildApp>>) {
  const callId = await createCallLink(app);
  await registerCallLeg({
    callId,
    participantIdentity: `host:${callId}`,
    participantRole: "host",
    joinType: "app",
  });
  return callId;
}

function dial(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  targetPhone = "+8613800000000",
) {
  return app.inject({
    method: "POST",
    url: `/call-links/${callId}/sip-outbound`,
    payload: {
      targetPhone,
      sourceLanguage: "zh",
      targetLanguage: "en",
      disclosureConfirmed: true,
    },
  });
}

function providerSuccess(): ProviderAdapterResult<{
  participantIdentity: string;
}> {
  return {
    ok: true,
    provider: "livekit_sip",
    externalOperationId: "sip-call-1",
    externalResourceId: "PA_1",
    capabilities: ["sip_outbound"],
    result: { participantIdentity: "sip:operation" },
  };
}

const envKeys = [
  "CALL_PROVIDER_POLICY",
  "CALL_ROOM_PROVIDER",
  "INTERNAL_API_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_SIP_OUTBOUND_TRUNK_ID",
  "LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS",
  "LIVEKIT_SIP_MEDIA_ROUTING_MODE",
  "LIVEKIT_URL",
  "LIVEKIT_WEBHOOK_URL",
  "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_MAX_CALL_MINUTES",
  "PSTN_PROVIDER",
  "PSTN_RECORDING_DISCLOSURE_ENABLED",
  "PUBLIC_CALL_BASE_URL",
];

function configureEnv() {
  process.env.CALL_PROVIDER_POLICY = "pstn_enabled";
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.INTERNAL_API_SECRET = "internal-secret-123456789";
  process.env.LIVEKIT_API_KEY = "livekit_key";
  process.env.LIVEKIT_API_SECRET = "livekit_secret_123456789012345678";
  process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID = "ST_testtrunk";
  process.env.LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS = "30";
  process.env.LIVEKIT_SIP_MEDIA_ROUTING_MODE = "translated_tracks_only";
  process.env.LIVEKIT_URL = "wss://livekit.qkxy.cn";
  process.env.LIVEKIT_WEBHOOK_URL = "https://api.qkxy.cn/webhooks/livekit";
  process.env.PSTN_CONSENT_PROMPT_VERSION = "test-v1";
  process.env.PSTN_MAX_CALL_MINUTES = "60";
  process.env.PSTN_PROVIDER = "livekit_sip";
  process.env.PSTN_RECORDING_DISCLOSURE_ENABLED = "true";
  process.env.PUBLIC_CALL_BASE_URL = "https://call.qkxy.cn";
}

function resetStore() {
  const store = getStoreSnapshot();
  store.accounts = [];
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
  store.providerOperations = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
