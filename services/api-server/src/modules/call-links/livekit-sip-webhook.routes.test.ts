import { createHash } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";
import { liveKitSipParticipantIdentity } from "./livekit-sip-identity.js";

describe("LiveKit SIP webhook reconciliation", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    });
    setCallLinkWorkerSupervisorForTests(new RecordingWorker());
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previousEnv);
  });

  it("settles answered duration and deduplicates a signed terminal event", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);
    const answeredAt = epochSeconds();
    const joined = webhookEvent(call, "joined-1", "participant_joined", answeredAt);
    const left = webhookEvent(call, "left-1", "participant_left", answeredAt + 6);

    const joinedResponse = await sendWebhook(app, joined);
    const leftResponse = await sendWebhook(app, left);
    const duplicate = await sendWebhook(app, left);
    await app.close();

    expect(joinedResponse.json().status).toBe("active");
    expect(leftResponse.json().status).toBe("succeeded");
    expect(duplicate.json().status).toBe("duplicate");
    expect(getStoreSnapshot().sessions[0]).toMatchObject({
      status: "ended",
      consumedSeconds: 6,
    });
    expect(getStoreSnapshot().inboxEvents).toHaveLength(2);
  });

  it("defers an out-of-order left event until the joined event arrives", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);
    const answeredAt = epochSeconds();

    const left = await sendWebhook(
      app,
      webhookEvent(call, "left-first", "participant_left", answeredAt + 4),
    );
    const joined = await sendWebhook(
      app,
      webhookEvent(call, "joined-late", "participant_joined", answeredAt),
    );
    await app.close();

    expect(left.json().status).toBe("pending_reconciliation");
    expect(joined.json().status).toBe("succeeded");
    expect(getStoreSnapshot().sessions[0]).toMatchObject({
      status: "ended",
      consumedSeconds: 4,
    });
  });

  it("zero-bills a connection-aborted call", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);

    const response = await sendWebhook(
      app,
      webhookEvent(call, "aborted-1", "participant_connection_aborted"),
    );
    await app.close();

    expect(response.json().status).toBe("failed");
    expect(getStoreSnapshot().sessions[0]).toMatchObject({
      status: "ended",
      consumedSeconds: 0,
    });
  });

  it("does not treat a dialing participant_joined webhook as answered", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);

    const response = await sendWebhook(app, webhookEvent(
      call,
      "dialing-joined",
      "participant_joined",
      undefined,
      { "sip.callStatus": "dialing" },
    ));
    await app.close();

    expect(response.json().status).toBe("dialing");
    expect(getStoreSnapshot().providerOperations[0]?.status).toBe("accepted");
    expect(getStoreSnapshot().providerOperations[0]?.answeredAt).toBeUndefined();
  });

  it("rejects a replayed event id with a changed signed payload", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);
    const first = webhookEvent(call, "same-id", "participant_joined");
    const changed = webhookEvent(call, "same-id", "participant_joined", undefined, {
      "sip.callStatus": "automation",
    });

    const accepted = await sendWebhook(app, first);
    const conflict = await sendWebhook(app, changed);
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("livekit_webhook_payload_conflict");
  });

  it("rejects an invalid signature before changing operation state", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);
    const body = JSON.stringify(webhookEvent(call, "joined-1", "participant_joined"));

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/livekit",
      headers: {
        authorization: "invalid",
        "content-type": "application/webhook+json",
      },
      payload: body,
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("invalid_livekit_webhook_signature");
    expect(getStoreSnapshot().providerOperations[0]?.status).toBe("accepted");
  });
});

class RecordingWorker implements CallLinkWorkerRuntime {
  async ensure() {}
  markReady() {}
  stop() {}
  shutdown() {}
}

async function createAcceptedSipCall(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const created = await app.inject({ method: "POST", url: "/call-links" });
  const callId = created.json().callId as string;
  const roomName = `call_${callId}`;
  const started = beginProviderOperation({
    sessionId: callId,
    provider: "livekit_sip",
    operationType: "sip_outbound",
    idempotencyKey: `sip-outbound:${callId}`,
    requestHash: "test-request-hash",
  }).operation;
  updateProviderOperation({
    operationId: started.id,
    status: "accepted",
    externalOperationId: "sip-call-1",
    externalResourceId: "PA_1",
  });
  return { callId, roomName, operationId: started.id };
}

function webhookEvent(
  call: { callId: string; roomName: string; operationId: string },
  id: string,
  event: "participant_joined" | "participant_left" |
    "participant_connection_aborted",
  createdAt = epochSeconds(),
  extraAttributes: Record<string, string> = {},
) {
  return {
    id,
    event,
    createdAt: String(createdAt),
    room: { sid: "RM_1", name: call.roomName },
    participant: {
      sid: "PA_1",
      identity: liveKitSipParticipantIdentity(call.callId, call.operationId),
      attributes: {
        "translation.operationId": call.operationId,
        "translation.sessionId": call.callId,
        "translation.role": "guest",
        "sip.callID": "sip-call-1",
        ...(event === "participant_joined"
          ? { "sip.callStatus": "active" }
          : {}),
        ...extraAttributes,
      },
    },
  };
}

async function sendWebhook(
  app: Awaited<ReturnType<typeof buildApp>>,
  event: ReturnType<typeof webhookEvent>,
) {
  const body = JSON.stringify(event);
  const token = new AccessToken("livekit_key", liveKitSecret());
  token.sha256 = createHash("sha256").update(body).digest("base64");
  return app.inject({
    method: "POST",
    url: "/webhooks/livekit",
    headers: {
      authorization: await token.toJwt(),
      "content-type": "application/webhook+json",
    },
    payload: body,
  });
}

function epochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function liveKitSecret() {
  return "livekit_secret_123456789012345678";
}

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "INTERNAL_API_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_URL",
  "PUBLIC_CALL_BASE_URL",
];

function configureEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.INTERNAL_API_SECRET = "internal-secret-123456789";
  process.env.LIVEKIT_API_KEY = "livekit_key";
  process.env.LIVEKIT_API_SECRET = liveKitSecret();
  process.env.LIVEKIT_URL = "wss://livekit.qkxy.cn";
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
