import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAdapterResult } from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import { beginProviderOperation, updateProviderOperation } from
  "../provider-operations/provider-operations.repository.js";
import { setCallLinkWorkerSupervisorForTests } from
  "./call-link-worker-supervisor.js";
import { setLiveKitSipProviderFactoryForTests } from
  "./call-link-sip.routes.js";
import { setTranslationCallControlPublisherForTests } from
  "./call-link-translation-control.routes.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import { registerCallLeg } from "./call-links.service.js";

describe("Call Link translation control routes", () => {
  let previousEnv: Record<string, string | undefined>;
  const publish = vi.fn(async () => ({ workerIdentity: "worker-1" }));

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    publish.mockClear();
    setLiveKitSipProviderFactoryForTests(() => ({
      createParticipant: async () => sipSuccess(),
    }));
    setCallRoomDataPublisherForTests({ async ensureRoom() {} });
    setCallLinkWorkerSupervisorForTests(new ReadyWorker());
    setTranslationCallControlPublisherForTests({ publish });
  });

  afterEach(() => {
    setLiveKitSipProviderFactoryForTests(null);
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    setTranslationCallControlPublisherForTests(null);
    restoreEnv(previousEnv);
  });

  it("persists one operation and outbox for an idempotent typed request", async () => {
    const app = await buildApp();
    const call = await connectedCall(app);
    const request = typedRequest("请稍等");

    const first = await app.inject({
      method: "POST",
      url: `/call-links/${call.callId}/type-to-speak`,
      payload: request,
    });
    getStoreSnapshot().workerDispatches[0]!.generation = 8;
    getStoreSnapshot().workerDispatches[0]!.version += 1;
    getStoreSnapshot().sessions[0]!.callLink!.translationControl!.uplinkPaused = true;
    const replay = await app.inject({
      method: "POST",
      url: `/call-links/${call.callId}/type-to-speak`,
      payload: request,
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/call-links/${call.callId}/type-to-speak`,
      payload: typedRequest("内容已改变"),
    });
    await app.close();

    expect(first).toMatchObject({ statusCode: 202 });
    expect(first.json()).toMatchObject({ status: "accepted", replayed: false });
    expect(replay).toMatchObject({ statusCode: 202 });
    expect(replay.json()).toMatchObject({
      operationId: first.json().operationId,
      replayed: true,
    });
    expect(conflict).toMatchObject({ statusCode: 409 });
    expect(conflict.json()).toMatchObject({
      error: { code: "translation_control_operation_conflict" },
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(getStoreSnapshot().providerOperations.filter((operation) =>
      operation.operationType === "translation_type_to_speak")).toHaveLength(1);
    expect(getStoreSnapshot().outboxEvents.filter((event) =>
      event.eventType === "translation_call_control.delivery"))
      .toHaveLength(1);
    expect(getStoreSnapshot().outboxEvents.find((event) =>
      event.eventType === "translation_call_control.delivery")?.payload)
      .toMatchObject({ command: { dispatchGeneration: 7 } });
  });

  it("requires prepared before typed execution can settle", async () => {
    const app = await buildApp();
    const call = await connectedCall(app);
    const started = await app.inject({
      method: "POST",
      url: `/call-links/${call.callId}/type-to-speak`,
      payload: typedRequest("请稍等"),
    });
    const operationId = started.json().operationId as string;
    const body = {
      dialOperationId: call.dialOperationId,
      dispatchGeneration: 7,
      controlGeneration: 1,
    };
    const premature = await workerStatus(app, call.callId, operationId, {
      ...body,
      status: "succeeded",
    });

    const prepared = await workerStatus(app, call.callId, operationId, {
      ...body,
      status: "prepared",
    });
    const succeeded = await workerStatus(app, call.callId, operationId, {
      ...body,
      status: "succeeded",
    });
    await app.close();

    expect(premature).toMatchObject({ statusCode: 409 });
    expect(prepared).toMatchObject({ statusCode: 200 });
    expect(prepared.json()).toMatchObject({ status: "active" });
    expect(succeeded).toMatchObject({ statusCode: 200 });
    expect(succeeded.json()).toMatchObject({ status: "succeeded" });
    expect(getStoreSnapshot().outboxEvents.find((event) =>
      event.idempotencyKey === `translation-control-delivery:${operationId}`))
      .toMatchObject({ publishedAt: expect.any(String) });
  });

  it("keeps resume paused until prepared and final Worker receipts", async () => {
    const app = await buildApp();
    const call = await connectedCall(app);
    const pause = await uplinkControl(app, call.callId, true, "pause-key-0001");
    const pauseOperationId = pause.json().operationId as string;

    expect(pause.json()).toMatchObject({
      status: "accepted",
      controlGeneration: 2,
      uplinkPaused: true,
    });
    await workerStatus(app, call.callId, pauseOperationId, {
      dialOperationId: call.dialOperationId,
      dispatchGeneration: 7,
      controlGeneration: 2,
      status: "succeeded",
    });

    const resume = await uplinkControl(
      app,
      call.callId,
      false,
      "resume-key-0001",
    );
    const resumeOperationId = resume.json().operationId as string;
    expect(resume.json()).toMatchObject({
      status: "accepted",
      controlGeneration: 3,
      uplinkPaused: true,
    });
    const prepared = await workerStatus(app, call.callId, resumeOperationId, {
      dialOperationId: call.dialOperationId,
      dispatchGeneration: 7,
      controlGeneration: 3,
      status: "prepared",
    });
    expect(prepared.json()).toMatchObject({ uplinkPaused: true });

    const succeeded = await workerStatus(app, call.callId, resumeOperationId, {
      dialOperationId: call.dialOperationId,
      dispatchGeneration: 7,
      controlGeneration: 3,
      status: "succeeded",
    });
    await app.close();

    expect(succeeded.json()).toMatchObject({
      status: "succeeded",
      uplinkPaused: false,
    });
  });

  it("blocks a second uplink command during the operation-state crash window", async () => {
    const app = await buildApp();
    const call = await connectedCall(app);
    beginProviderOperation({
      sessionId: call.callId,
      provider: "livekit",
      operationType: "translation_uplink_control",
      operationKey: "c2:d7:uplink-control",
      idempotencyKey: `translation-uplink:${call.callId}:orphan-key-0001`,
      requestHash: "orphan-request-hash-at-least-sixteen-bytes",
    });

    const response = await uplinkControl(
      app,
      call.callId,
      true,
      "new-pause-key-0001",
    );
    await app.close();

    expect(response).toMatchObject({ statusCode: 409 });
    expect(response.json()).toMatchObject({
      error: { code: "translation_control_pending" },
    });
    expect(getStoreSnapshot().providerOperations.filter((operation) =>
      operation.operationType === "translation_uplink_control"))
      .toHaveLength(1);
  });
});

class ReadyWorker {
  async ensure() {}
  markReady() {}
  stop() {}
  shutdown() {}
}

async function connectedCall(app: Awaited<ReturnType<typeof buildApp>>) {
  const created = await app.inject({ method: "POST", url: "/call-links" });
  const callId = created.json().callId as string;
  await registerCallLeg({
    callId,
    participantIdentity: `host:${callId}`,
    participantRole: "host",
    joinType: "app",
  });
  await app.inject({
    method: "POST",
    url: `/call-links/${callId}/sip-outbound`,
    payload: {
      targetPhone: "+8613800000000",
      sourceLanguage: "zh",
      targetLanguage: "en",
      disclosureConfirmed: true,
    },
  });
  const dial = getStoreSnapshot().providerOperations.find((operation) =>
    operation.operationType === "sip_outbound")!;
  updateProviderOperation({
    operationId: dial.id,
    status: "active",
    expectedVersion: dial.version,
  });
  const now = new Date();
  getStoreSnapshot().workerDispatches = [{
    id: `dispatch-${callId}`,
    callId,
    sessionId: callId,
    roomName: getStoreSnapshot().sessions[0]!.callLink!.roomName,
    provider: "livekit_dispatch",
    agentName: "call-translation",
    status: "ready",
    generation: 7,
    version: 1,
    leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    generationStartedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    readyAt: now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
  }];
  return { callId, dialOperationId: dial.id };
}

function typedRequest(text: string) {
  return { text, idempotencyKey: "typed-text-0001" };
}

function uplinkControl(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  paused: boolean,
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: `/call-links/${callId}/translation-uplink`,
    payload: { paused, idempotencyKey },
  });
}

function workerStatus(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  operationId: string,
  payload: object,
) {
  return app.inject({
    method: "POST",
    url: `/internal/call-links/${callId}/translation-controls/${operationId}/status`,
    headers: { authorization: `Bearer ${process.env.INTERNAL_API_SECRET}` },
    payload,
  });
}

function sipSuccess(): ProviderAdapterResult<{ participantIdentity: string }> {
  return {
    ok: true,
    provider: "livekit_sip",
    capabilities: ["sip_outbound"],
    result: { participantIdentity: "sip:operation" },
  };
}

const envKeys = [
  "CALL_PROVIDER_POLICY", "CALL_ROOM_PROVIDER", "INTERNAL_API_SECRET",
  "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_SIP_OUTBOUND_TRUNK_ID",
  "LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS", "LIVEKIT_SIP_MEDIA_ROUTING_MODE",
  "LIVEKIT_URL", "LIVEKIT_WEBHOOK_URL", "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_MAX_CALL_MINUTES", "PSTN_PROVIDER",
  "PSTN_RECORDING_DISCLOSURE_ENABLED", "PUBLIC_CALL_BASE_URL",
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
  Object.assign(store, {
    accounts: [], sessions: [], usageBalances: {}, usageHolds: [],
    billingLedger: [], providerOperations: [], workerDispatches: [],
    workerCapacityReservations: [], inboxEvents: [], outboxEvents: [],
  });
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
