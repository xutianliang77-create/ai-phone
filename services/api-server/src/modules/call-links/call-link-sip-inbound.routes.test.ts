import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";
import { registerCallLeg } from "./call-links.service.js";

describe("Call Link SIP inbound public admission", () => {
  let previousEnv: Record<string, string | undefined>;
  let ensureRoomCall: ReturnType<typeof vi.fn>;
  let worker: RecordingWorker;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    ensureRoomCall = vi.fn(async (_roomName: string) => {});
    worker = new RecordingWorker();
    setCallRoomDataPublisherForTests({ ensureRoom: ensureRoomCall });
    setCallLinkWorkerSupervisorForTests(worker);
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previousEnv);
  });

  it("rejects an unbound public call before creating a room or dispatch", async () => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-test";
    const app = await buildApp();
    const callId = await createHostReadyCall(app);

    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/sip-inbound`,
      payload: { pin: "123456", idempotencyKey: "inbound-public-1" },
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe(
      "call_link_public_model_authorization_required",
    );
    expect(ensureRoomCall).not.toHaveBeenCalled();
    expect(worker.ensuredCallIds).toEqual([]);
  });
});

class RecordingWorker implements CallLinkWorkerRuntime {
  readonly ensuredCallIds: string[] = [];
  async ensure(callId: string) {
    this.ensuredCallIds.push(callId);
  }
  markReady() {}
  stop() {}
  shutdown() {}
}

async function createHostReadyCall(app: Awaited<ReturnType<typeof buildApp>>) {
  const created = await app.inject({ method: "POST", url: "/call-links" });
  const callId = created.json().callId as string;
  await registerCallLeg({
    callId,
    participantIdentity: `host:${callId}`,
    participantRole: "host",
    joinType: "app",
  });
  return callId;
}

const envKeys = [
  "CALL_PROVIDER_POLICY",
  "CALL_ROOM_PROVIDER",
  "INTERNAL_API_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_SIP_OUTBOUND_TRUNK_ID",
  "LIVEKIT_SIP_INBOUND_ENABLED",
  "LIVEKIT_SIP_INBOUND_TRUNK_ID",
  "LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK",
  "LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER",
  "LIVEKIT_SIP_MEDIA_ROUTING_MODE",
  "LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS",
  "LIVEKIT_URL",
  "LIVEKIT_WEBHOOK_URL",
  "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_MAX_CALL_MINUTES",
  "PSTN_PROVIDER",
  "PSTN_RECORDING_DISCLOSURE_ENABLED",
  "PUBLIC_CALL_BASE_URL",
  "API_RESULT_SYNC_DEPLOYMENT_ID",
];

function configureEnv() {
  process.env.CALL_PROVIDER_POLICY = "pstn_enabled";
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.INTERNAL_API_SECRET = "internal-secret-123456789";
  process.env.LIVEKIT_API_KEY = "livekit_key";
  process.env.LIVEKIT_API_SECRET = "livekit_secret_123456789012345678";
  process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID = "ST_testtrunk";
  process.env.LIVEKIT_SIP_INBOUND_ENABLED = "true";
  process.env.LIVEKIT_SIP_INBOUND_TRUNK_ID = "ST_inbound_test";
  process.env.LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK = "true";
  process.env.LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER = "+8613800000000";
  process.env.LIVEKIT_SIP_MEDIA_ROUTING_MODE = "translated_tracks_only";
  process.env.LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS = "30";
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
