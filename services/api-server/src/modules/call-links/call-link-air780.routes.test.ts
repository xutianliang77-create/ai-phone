import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AirDeviceCallDto,
  TelephonyProvider,
} from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setAir780CallLinkTelephonyRuntimeForTests,
} from "./air780-call-link-outbound-coordinator.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import { setAirDeviceCarrierEventProcessorForTests } from
  "../device-calls/air-device-call.routes.js";
import {
  setCallLinkWorkerSupervisorForTests,
} from "./call-link-worker-supervisor.js";
import {
  air780CarrierCall as carrierCall,
  air780CarrierEvent as carrierEvent,
  air780DialPayload as dialPayload,
  air780DialResult as airResult,
  captureAir780TestEnv as captureEnv,
  configureAir780TestEnv as configureEnv,
  createHostReadyAir780Call as createHostReadyCall,
  fakeAir780Runtime as fakeRuntime,
  ReadyAir780Worker as ReadyWorker,
  resetAir780TestStore as resetStore,
  restoreAir780TestEnv as restoreEnv,
} from "./call-link-air780.routes.test-support.js";

describe("Call Link Air780 translation routes", () => {
  let previousEnv: Record<string, string | undefined>;
  let placePhoneCall: ReturnType<typeof vi.fn>;
  let hangupPhoneCall: ReturnType<typeof vi.fn<TelephonyProvider["hangupPhoneCall"]>>;
  let carrierState: AirDeviceCallDto["carrierState"] = "dialing";

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    carrierState = "dialing";
    placePhoneCall = vi.fn(async (request) => airResult(request.payload));
    hangupPhoneCall = vi.fn<TelephonyProvider["hangupPhoneCall"]>(async (request) => ({
      ok: true,
      provider: "air780_volte" as const,
      externalOperationId: request.operationId,
      externalResourceId: request.payload.providerCallId,
      capabilities: ["hangup"],
      result: {
        communicationSessionId: request.payload.communicationSessionId,
        providerCallId: request.payload.providerCallId,
        state: "ending" as const,
      },
    }));
    setAir780CallLinkTelephonyRuntimeForTests(fakeRuntime({
      placePhoneCall,
      hangupPhoneCall,
    }));
    setCallRoomDataPublisherForTests({ async ensureRoom() {} });
    setAirDeviceCarrierEventProcessorForTests({
      async processCarrierEvent(event) {
        return carrierCall(event);
      },
    });
    setCallLinkWorkerSupervisorForTests(new ReadyWorker());
  });

  afterEach(() => {
    setAir780CallLinkTelephonyRuntimeForTests(null);
    setCallRoomDataPublisherForTests(null);
    setAirDeviceCarrierEventProcessorForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previousEnv);
  });

  it("places an Air780 translation call through the unified phone contract", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);

    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: dialPayload(),
    });
    await app.close();

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      provider: "air780_volte",
      status: "accepted",
      participantIdentity: `${callId}:guest:air:device-1`,
    });
    expect(placePhoneCall).toHaveBeenCalledTimes(1);
    expect(getStoreSnapshot().sessions[0]?.callLegs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        participantIdentity: `${callId}:guest:air:device-1`,
        participantRole: "guest",
        joinType: "sip",
        status: "active",
      }),
    ]));
  });

  it("rejects SIP-only initial DTMF instead of dropping it on Air780", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);

    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: { ...dialPayload(), initialDtmf: "123#" },
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: "air780_initial_dtmf_unsupported" },
    });
    expect(placePhoneCall).not.toHaveBeenCalled();
  });

  it("uses the Air780 control contract for hangup and does not call SIP", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: dialPayload(),
    });

    const response = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-hangup`,
      payload: {},
    });
    await app.close();

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      operationType: "phone_hangup",
      status: "accepted",
    });
    expect(hangupPhoneCall).toHaveBeenCalledTimes(1);
  });

  it("retries a definitely undispatched hangup with the same operation", async () => {
    hangupPhoneCall.mockResolvedValueOnce({
      ok: false,
      provider: "air780_volte",
      errorClass: "unavailable",
      retryable: true,
      reconciliationRequired: false,
    });
    const app = await buildApp();
    const callId = await createHostReadyCall(app);
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: dialPayload(),
    });

    const first = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-hangup`,
      payload: {},
    });
    const retry = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-hangup`,
      payload: {},
    });
    const terminal = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET}` },
      payload: carrierEvent({
        communicationSessionId: callId,
        eventSequence: 1,
        carrierState: "disconnected",
        carrierCause: "local_hangup",
        occurredAt: "2026-08-06T10:00:08.000Z",
      }),
    });
    await app.close();

    expect(first.statusCode).toBe(503);
    expect(retry.statusCode).toBe(202);
    expect(terminal.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      operationType: "phone_hangup",
      status: "accepted",
      replayed: true,
    });
    expect(hangupPhoneCall).toHaveBeenCalledTimes(2);
    expect(hangupPhoneCall.mock.calls[1]?.[0]).toMatchObject({
      operationId: hangupPhoneCall.mock.calls[0]?.[0].operationId,
      idempotencyKey: hangupPhoneCall.mock.calls[0]?.[0].idempotencyKey,
    });
    expect(getStoreSnapshot().providerOperations.find((operation) =>
      operation.operationType === "phone_hangup"))
      .toMatchObject({ status: "succeeded", attempt: 2 });
  });

  it("ends a translation session from carrier state, not LiveKit presence", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);
    const started = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: dialPayload(),
    });
    const operationId = started.json().operationId as string;
    const connectedAt = "2026-08-06T10:00:00.000Z";
    carrierState = "connected";
    const connected = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET}` },
      payload: carrierEvent({
        communicationSessionId: callId,
        eventSequence: 1,
        carrierState: "connected",
        occurredAt: connectedAt,
      }),
    });
    carrierState = "disconnected";
    const disconnected = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET}` },
      payload: carrierEvent({
        communicationSessionId: callId,
        eventSequence: 2,
        carrierState: "disconnected",
        occurredAt: "2026-08-06T10:00:08.000Z",
        carrierCause: "remote_hangup",
      }),
    });
    await app.close();

    const store = getStoreSnapshot();
    expect(connected.statusCode).toBe(200);
    expect(disconnected.statusCode).toBe(200);
    expect(store.sessions[0]).toMatchObject({ status: "ended", consumedSeconds: 8 });
    expect(store.providerOperations.find((item) => item.id === operationId))
      .toMatchObject({ status: "succeeded" });
  });

  it("quarantines a connected translation call on carrier unknown without a second dial", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);
    const started = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: dialPayload(),
    });
    const operationId = started.json().operationId as string;
    carrierState = "connected";
    await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET}` },
      payload: carrierEvent({
        communicationSessionId: callId,
        eventSequence: 1,
        carrierState: "connected",
        occurredAt: "2026-08-06T10:00:00.000Z",
      }),
    });
    carrierState = "unknown";
    const unknown = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET}` },
      payload: carrierEvent({
        communicationSessionId: callId,
        eventSequence: 2,
        carrierState: "unknown",
        carrierCause: "unknown",
        occurredAt: "2026-08-06T10:00:01.000Z",
      }),
    });
    await app.close();

    expect(unknown.statusCode).toBe(200);
    expect(placePhoneCall).toHaveBeenCalledTimes(1);
    expect(getStoreSnapshot().providerOperations.find((item) => item.id === operationId))
      .toMatchObject({ status: "unknown", lastErrorClass: "carrier_unknown" });
    expect(getStoreSnapshot().sessions[0]).toMatchObject({ status: "created" });
  });

  it("returns the current Air780 operation status only to the owning host", async () => {
    const app = await buildApp();
    const callId = await createHostReadyCall(app);
    await app.inject({
      method: "POST",
      url: `/call-links/${callId}/air780-outbound`,
      payload: dialPayload(),
    });
    carrierState = "unknown";
    await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET}` },
      payload: carrierEvent({
        communicationSessionId: callId,
        eventSequence: 1,
        carrierState: "unknown",
        carrierCause: "unknown",
        occurredAt: "2026-08-06T10:00:01.000Z",
      }),
    });
    const status = await app.inject({
      method: "GET",
      url: `/call-links/${callId}/air780-status`,
    });
    await app.close();

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      callId,
      provider: "air780_volte",
      providerOperationStatus: "unknown",
    });
  });
});
