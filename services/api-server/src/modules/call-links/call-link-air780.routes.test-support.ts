import type {
  AirDeviceCallDto,
  AirDeviceCarrierEventRequest,
  PlacePhoneCallPayload,
  ProviderAdapterResult,
  TelephonyProvider,
} from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import type { Air780CallLinkTelephonyRuntime } from
  "./air780-call-link-outbound-coordinator.js";
import type { CallLinkWorkerRuntime } from
  "./call-link-worker-supervisor.js";
import { registerCallLeg } from "./call-links.service.js";

export class ReadyAir780Worker implements CallLinkWorkerRuntime {
  async ensure() {}
  markReady() {}
  stop() {}
  shutdown() {}
}

export function fakeAir780Runtime(input: {
  placePhoneCall: TelephonyProvider["placePhoneCall"];
  hangupPhoneCall: TelephonyProvider["hangupPhoneCall"];
  sendPhoneDtmf?: TelephonyProvider["sendPhoneDtmf"];
}): Air780CallLinkTelephonyRuntime {
  const lease = { deviceId: "device-1", leaseId: "lease-1", fencingToken: 7 };
  const adapter: TelephonyProvider = {
    placePhoneCall: input.placePhoneCall,
    hangupPhoneCall: input.hangupPhoneCall,
    sendPhoneDtmf: input.sendPhoneDtmf ??
      (async () => { throw new Error("not used"); }),
    reconcilePhoneCall: async () => { throw new Error("not used"); },
  };
  return {
    adapter,
    timeoutMs: 1_000,
    async buildPayload({ record, targetPhone }) {
      return {
        communicationSessionId: record.sessionId,
        transport: "air780_volte",
        callGeneration: lease.fencingToken,
        mediaPolicy: "translation_isolated" as const,
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

export function air780DialResult(
  payload: PlacePhoneCallPayload,
): ProviderAdapterResult<{
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

export function air780DialPayload() {
  return {
    targetPhone: "+8613800000000",
    sourceLanguage: "zh",
    targetLanguage: "en",
    disclosureConfirmed: true,
  };
}

export function air780CarrierEvent(input: {
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

export function air780CarrierCall(
  event: AirDeviceCarrierEventRequest,
): AirDeviceCallDto {
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
    mediaPolicy: "translation_isolated",
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

export async function createHostReadyAir780Call(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
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

export function configureAir780TestEnv() {
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
  process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET =
    "air-device-event-secret-with-32-chars";
}

export function resetAir780TestStore() {
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

export function captureAir780TestEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

export function restoreAir780TestEnv(
  values: Record<string, string | undefined>,
) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
