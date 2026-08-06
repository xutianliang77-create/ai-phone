import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AirDeviceCallDto,
  AirDeviceCarrierEventRequest,
  PhoneCallControlPayload,
  PlacePhoneCallPayload,
  ProviderAdapterResult,
  TelephonyProvider,
} from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setAir780CallLinkTelephonyRuntimeForTests,
  type Air780CallLinkTelephonyRuntime,
} from "./air780-call-link-outbound-coordinator.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import { setAirDeviceCarrierEventProcessorForTests } from
  "../device-calls/air-device-call.routes.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";
import { registerCallLeg } from "./call-links.service.js";

describe("Call Link Air780 translation routes", () => {
  let previousEnv: Record<string, string | undefined>;
  let placePhoneCall: ReturnType<typeof vi.fn>;
  let hangupPhoneCall: ReturnType<typeof vi.fn>;
  let carrierState: AirDeviceCallDto["carrierState"] = "dialing";

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    carrierState = "dialing";
    placePhoneCall = vi.fn(async (request) => airResult(request.payload));
    hangupPhoneCall = vi.fn(async (request) => ({
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
});

class ReadyWorker implements CallLinkWorkerRuntime {
  async ensure() {}
  markReady() {}
  stop() {}
  shutdown() {}
}

function fakeRuntime(input: {
  placePhoneCall: TelephonyProvider["placePhoneCall"];
  hangupPhoneCall: TelephonyProvider["hangupPhoneCall"];
}): Air780CallLinkTelephonyRuntime {
  const lease = { deviceId: "device-1", leaseId: "lease-1", fencingToken: 7 };
  const adapter: TelephonyProvider = {
    placePhoneCall: input.placePhoneCall,
    hangupPhoneCall: input.hangupPhoneCall,
    sendPhoneDtmf: async () => {
      throw new Error("not used");
    },
    reconcilePhoneCall: async () => {
      throw new Error("not used");
    },
  };
  return {
    adapter,
    timeoutMs: 1_000,
    async buildPayload({ record, targetPhone }) {
      return {
        communicationSessionId: record.sessionId,
        transport: "air780_volte",
        callGeneration: lease.fencingToken,
        roomName: record.roomName,
        phoneNumberReference: targetPhone,
        participantIdentity: `${record.sessionId}:guest:air:${lease.deviceId}`,
        deviceLease: lease,
      };
    },
    async resolveControlPayload({ record, operation }) {
      return {
        communicationSessionId: record.sessionId,
        providerCallId: operation.externalResourceId ?? "air-test-call",
        callGeneration: lease.fencingToken,
        deviceLease: lease,
      };
    },
    async releasePayload() {},
  };
}

function airResult(payload: PlacePhoneCallPayload): ProviderAdapterResult<{
  communicationSessionId: string;
  providerCallId: string;
  participantIdentity: string;
  state: "dialing";
}> {
  return {
    ok: true,
    provider: "air780_volte",
    externalOperationId: "air-op-1",
    externalResourceId: "air-call-1",
    capabilities: ["phone_outbound", "hangup"],
    result: {
      communicationSessionId: payload.communicationSessionId,
      providerCallId: "air-call-1",
      participantIdentity: payload.participantIdentity,
      state: "dialing",
    },
  };
}

function dialPayload() {
  return {
    targetPhone: "+8613800000000",
    sourceLanguage: "zh",
    targetLanguage: "en",
    disclosureConfirmed: true,
  };
}

function carrierEvent(input: {
  communicationSessionId: string;
  eventSequence: number;
  carrierState: AirDeviceCarrierEventRequest["carrierState"];
  occurredAt: string;
  carrierCause?: AirDeviceCarrierEventRequest["carrierCause"];
}) {
  return {
    eventId: `event-${input.eventSequence}`,
    communicationSessionId: input.communicationSessionId,
    providerCallId: "air-call-1",
    deviceId: "device-1",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 7,
    eventSequence: input.eventSequence,
    carrierState: input.carrierState,
    carrierCause: input.carrierCause ?? "none",
    occurredAt: input.occurredAt,
  };
}

function carrierCall(event: AirDeviceCarrierEventRequest): AirDeviceCallDto {
  return {
    providerCallId: event.providerCallId,
    communicationSessionId: event.communicationSessionId,
    providerOperationId: getStoreSnapshot().providerOperations[0]!.id,
    deviceId: event.deviceId,
    leaseId: event.leaseId,
    fencingToken: event.fencingToken,
    carrierState: event.carrierState,
    liveKitParticipantState: "joined",
    callGeneration: event.callGeneration,
    version: event.eventSequence,
    ...(event.carrierState === "connected"
      ? { connectedAt: "2026-08-06T10:00:00.000Z" }
      : event.carrierState === "disconnected"
        ? {
          connectedAt: "2026-08-06T10:00:00.000Z",
          endedAt: event.occurredAt,
        }
        : {}),
  };
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
  "CALL_PROVIDER_POLICY", "CALL_ROOM_PROVIDER", "INTERNAL_API_SECRET",
  "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_URL",
  "PSTN_CONSENT_PROMPT_VERSION", "PSTN_MAX_CALL_MINUTES", "PSTN_PROVIDER",
  "PSTN_RECORDING_DISCLOSURE_ENABLED", "PUBLIC_CALL_BASE_URL",
  "AIR_DEVICE_GATEWAY_EVENT_SECRET",
];

function configureEnv() {
  process.env.CALL_PROVIDER_POLICY = "pstn_enabled";
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.INTERNAL_API_SECRET = "internal-secret-123456789";
  process.env.LIVEKIT_API_KEY = "livekit_key";
  process.env.LIVEKIT_API_SECRET = "livekit_secret_123456789012345678";
  process.env.LIVEKIT_URL = "wss://livekit.qkxy.cn";
  process.env.PSTN_CONSENT_PROMPT_VERSION = "test-v1";
  process.env.PSTN_MAX_CALL_MINUTES = "60";
  process.env.PSTN_PROVIDER = "air780_volte";
  process.env.PSTN_RECORDING_DISCLOSURE_ENABLED = "true";
  process.env.PUBLIC_CALL_BASE_URL = "https://call.qkxy.cn";
  process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET = "air-device-event-secret-with-32-chars";
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
