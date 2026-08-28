import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelephonyProvider } from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import { setAirDeviceCarrierEventProcessorForTests } from
  "../device-calls/air-device-call.routes.js";
import { setAir780CallLinkTelephonyRuntimeForTests } from
  "./air780-call-link-outbound-coordinator.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import { setCallLinkWorkerSupervisorForTests } from
  "./call-link-worker-supervisor.js";
import {
  air780CarrierCall,
  air780CarrierEvent,
  air780DialPayload,
  air780DialResult,
  captureAir780TestEnv,
  configureAir780TestEnv,
  createHostReadyAir780Call,
  fakeAir780Runtime,
  ReadyAir780Worker,
  resetAir780TestStore,
  restoreAir780TestEnv,
} from "./call-link-air780.routes.test-support.js";

describe("Call Link Air780 DTMF routes", () => {
  let previousEnv: Record<string, string | undefined>;
  let carrierConnected: boolean;
  let sendPhoneDtmf: ReturnType<
    typeof vi.fn<TelephonyProvider["sendPhoneDtmf"]>
  >;

  beforeEach(() => {
    previousEnv = captureAir780TestEnv();
    configureAir780TestEnv();
    resetAir780TestStore();
    carrierConnected = false;
    sendPhoneDtmf = vi.fn<TelephonyProvider["sendPhoneDtmf"]>(
      async (request) => acceptedDtmf(request),
    );
    const runtime = fakeAir780Runtime({
      placePhoneCall: vi.fn(async (request) =>
        air780DialResult(request.payload)),
      hangupPhoneCall: vi.fn(async () => {
        throw new Error("not used");
      }),
      sendPhoneDtmf,
    });
    const resolve = runtime.resolveControlPayload.bind(runtime);
    runtime.resolveControlPayload = async (input) => {
      if (input.action === "dtmf" && !carrierConnected) {
        throw new Error("carrier is not connected");
      }
      return resolve(input);
    };
    setAir780CallLinkTelephonyRuntimeForTests(runtime);
    setCallRoomDataPublisherForTests({ async ensureRoom() {} });
    setCallLinkWorkerSupervisorForTests(new ReadyAir780Worker());
    setAirDeviceCarrierEventProcessorForTests({
      async processCarrierEvent(event) {
        carrierConnected = event.carrierState === "connected";
        return air780CarrierCall(event);
      },
    });
  });

  afterEach(() => {
    setAir780CallLinkTelephonyRuntimeForTests(null);
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    setAirDeviceCarrierEventProcessorForTests(null);
    restoreAir780TestEnv(previousEnv);
  });

  it("dispatches connected-call DTMF once and replays the operation", async () => {
    const app = await buildApp();
    const callId = await startConnectedCall(app);
    const payload = { digit: "5", idempotencyKey: "dtmf-key-0001" };

    const first = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload,
    });
    await app.close();

    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      operationId: first.json().operationId,
      operationType: "phone_dtmf",
      replayed: true,
    });
    expect(sendPhoneDtmf).toHaveBeenCalledTimes(1);
    expect(sendPhoneDtmf.mock.calls[0]?.[0].payload).toMatchObject({
      communicationSessionId: callId,
      digits: "5",
    });
  });

  it("rejects the same idempotency key with a different digit", async () => {
    const app = await buildApp();
    const callId = await startConnectedCall(app);
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload: { digit: "1", idempotencyKey: "dtmf-key-0002" },
    });

    const conflict = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload: { digit: "2", idempotencyKey: "dtmf-key-0002" },
    });
    await app.close();

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "air780_dtmf_operation_conflict" },
    });
    expect(sendPhoneDtmf).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch DTMF before carrier connected", async () => {
    const app = await buildApp();
    const callId = await startCall(app);

    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload: { digit: "#", idempotencyKey: "dtmf-key-0003" },
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "air780_dtmf_not_connected" },
    });
    expect(sendPhoneDtmf).not.toHaveBeenCalled();
    expect(getStoreSnapshot().providerOperations.find((operation) =>
      operation.operationType === "phone_dtmf")).toMatchObject({
        status: "failed",
        lastErrorClass: "unavailable",
      });
  });

  it("retries a definitely undispatched command with the same identity", async () => {
    sendPhoneDtmf.mockResolvedValueOnce({
      ok: false,
      provider: "air780_volte",
      errorClass: "unavailable",
      retryable: true,
      reconciliationRequired: false,
    });
    const app = await buildApp();
    const callId = await startConnectedCall(app);
    const payload = { digit: "9", idempotencyKey: "dtmf-key-0004" };

    const first = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload,
    });
    const retry = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload,
    });
    await app.close();

    expect(first.statusCode).toBe(503);
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({
      operationType: "phone_dtmf",
      replayed: true,
    });
    expect(sendPhoneDtmf).toHaveBeenCalledTimes(2);
    expect(sendPhoneDtmf.mock.calls[1]?.[0]).toMatchObject({
      operationId: sendPhoneDtmf.mock.calls[0]?.[0].operationId,
      idempotencyKey: sendPhoneDtmf.mock.calls[0]?.[0].idempotencyKey,
    });
  });

  it("coalesces a concurrent in-flight replay before adapter dispatch", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    sendPhoneDtmf.mockImplementationOnce(async (request) => {
      await blocked;
      return acceptedDtmf(request);
    });
    const app = await buildApp();
    const callId = await startConnectedCall(app);
    const payload = { digit: "A", idempotencyKey: "dtmf-key-0005" };

    const firstPromise = app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload,
    });
    await vi.waitFor(() => expect(sendPhoneDtmf).toHaveBeenCalledTimes(1));
    const replay = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-dtmf`,
      payload,
    });
    release();
    const first = await firstPromise;
    await app.close();

    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({ replayed: true });
    expect(sendPhoneDtmf).toHaveBeenCalledTimes(1);
  });
});

async function startCall(app: Awaited<ReturnType<typeof buildApp>>) {
  const callId = await createHostReadyAir780Call(app);
  const response = await app.inject({
    method: "POST",
    url: `/call-links/${callId}/air780-outbound`,
    payload: air780DialPayload(),
  });
  expect(response.statusCode).toBe(202);
  return callId;
}

async function startConnectedCall(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const callId = await startCall(app);
  const response = await app.inject({
    method: "POST",
    url: "/internal/device-calls/carrier-events",
    headers: {
      authorization: `Bearer ${process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET}`,
    },
    payload: air780CarrierEvent({
      communicationSessionId: callId,
      eventSequence: 1,
      carrierState: "connected",
      occurredAt: "2026-08-13T08:00:00.000Z",
    }),
  });
  expect(response.statusCode).toBe(200);
  return callId;
}

function acceptedDtmf(
  request: Parameters<TelephonyProvider["sendPhoneDtmf"]>[0],
) {
  return {
    ok: true as const,
    provider: "air780_volte" as const,
    externalOperationId: request.operationId,
    externalResourceId: request.payload.providerCallId,
    capabilities: ["dtmf" as const],
    result: {
      communicationSessionId: request.payload.communicationSessionId,
      providerCallId: request.payload.providerCallId,
      state: "active" as const,
    },
  };
}
