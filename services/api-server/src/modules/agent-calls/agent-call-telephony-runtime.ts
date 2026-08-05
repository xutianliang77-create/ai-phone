import { createHash } from "node:crypto";
import type {
  DeviceLeaseBinding,
  PhoneCallControlPayload,
  PlacePhoneCallPayload,
  TelephonyProvider,
} from "@translation/contracts";
import { LiveKitSipTelephonyProviderAdapter } from
  "../call-links/livekit-sip-telephony-provider-adapter.js";
import { liveKitSipParticipantIdentity } from
  "../call-links/livekit-sip-identity.js";
import { getLiveKitSipConfig } from "../call-links/livekit-sip-readiness.js";
import type { CallLinkRecord } from "../call-links/call-links.service.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import type { AgentCallProvider } from "./agent-call-provider-profile.js";
import { toAgentCallE164Phone } from "./agent-call-gray-policy.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import {
  Air780DeviceProviderAdapter,
  airDeviceProviderCallId,
} from
  "../device-calls/air780-device-provider-adapter.js";
import { getAirDeviceGatewayConfig } from
  "../device-calls/air-device-gateway-readiness.js";
import { createAirDeviceCallRoomToken } from
  "../device-calls/device-call-room-token.js";
import { DeviceLeaseConflict } from
  "../device-calls/device-lease-registry.js";
import { HttpAirDeviceGatewayClient } from
  "../device-calls/http-air-device-gateway-client.js";

export interface AgentCallTelephonyRuntime {
  provider: Extract<AgentCallProvider, "air780_volte" | "livekit_sip">;
  adapter: TelephonyProvider;
  timeoutMs: number;
  buildPayload(input: {
    draft: AgentCallRecord;
    call: CallLinkRecord;
    operation: ProviderOperationRecord;
  }): PlacePhoneCallPayload | Promise<PlacePhoneCallPayload>;
  resolveParticipantBinding(input: {
    call: CallLinkRecord;
    operation: ProviderOperationRecord;
  }): AgentCallPhoneBinding | Promise<AgentCallPhoneBinding>;
  resolveControlPayload(input: {
    call: CallLinkRecord;
    operation: ProviderOperationRecord;
    action: "dtmf" | "hangup";
  }): PhoneCallControlPayload | Promise<PhoneCallControlPayload>;
  isCarrierConnected?(input: {
    call: CallLinkRecord;
    operation: ProviderOperationRecord;
  }): boolean | Promise<boolean>;
  releasePayload?(payload: PlacePhoneCallPayload): void | Promise<void>;
}

export interface AgentCallPhoneBinding {
  providerCallId: string;
  participantIdentity: string;
  callGeneration: number;
  deviceLease?: DeviceLeaseBinding;
}

let testRuntime: AgentCallTelephonyRuntime | null = null;

export function setAgentCallTelephonyRuntimeForTests(
  runtime: AgentCallTelephonyRuntime | null,
) {
  testRuntime = runtime;
}

export function getAgentCallTelephonyRuntime(provider: AgentCallProvider) {
  if (testRuntime) {
    return testRuntime.provider === provider
      ? { ok: true as const, runtime: testRuntime }
      : { ok: false as const, issues: ["Agent call provider runtime mismatch"] };
  }
  if (provider === "air780_volte") {
    return air780Runtime();
  }
  if (provider !== "livekit_sip") {
    return {
      ok: false as const,
      issues: [`Agent call provider ${provider} uses the legacy bridge runtime`],
    };
  }
  const sip = getLiveKitSipConfig();
  if (!sip.ok) return { ok: false as const, issues: sip.issues };
  const runtime: AgentCallTelephonyRuntime = {
    provider,
    adapter: new LiveKitSipTelephonyProviderAdapter(sip.config),
    timeoutMs: sip.config.requestTimeoutSeconds * 1_000,
    buildPayload: ({ draft, call, operation }) => ({
      communicationSessionId: call.sessionId,
      transport: "livekit_sip",
      callGeneration: 0,
      roomName: call.roomName,
      phoneNumberReference: draft.targetPhone!,
      participantIdentity: liveKitSipParticipantIdentity(
        call.sessionId,
        operation.id,
      ),
    }),
    resolveParticipantBinding: ({ call, operation }) => ({
      providerCallId: operation.externalOperationId ??
        operation.externalResourceId ?? operation.id,
      participantIdentity: liveKitSipParticipantIdentity(
        call.sessionId,
        operation.id,
      ),
      callGeneration: 0,
    }),
    resolveControlPayload: ({ call, operation }) => ({
      communicationSessionId: call.sessionId,
      providerCallId: operation.externalOperationId ??
        operation.externalResourceId ?? operation.id,
      callGeneration: 0,
    }),
    isCarrierConnected: ({ operation }) => operation.status === "active",
  };
  return {
    ok: true as const,
    runtime,
  };
}

function air780Runtime() {
  const gateway = getAirDeviceGatewayConfig();
  const repository = getRepositoryRuntime();
  if (!gateway.ok || repository.driver !== "postgres") {
    return {
      ok: false as const,
      issues: [
        ...(gateway.ok ? [] : gateway.issues),
        ...(repository.driver === "postgres"
          ? []
          : ["Air780 telephony provider requires PostgreSQL primary storage"]),
      ],
    };
  }
  const adapter = new Air780DeviceProviderAdapter({
    leaseVerifier: repository.postgres.airDeviceRegistry,
    callRecorder: repository.postgres.airDeviceCalls,
    gateway: new HttpAirDeviceGatewayClient(gateway.config),
    roomAccessIssuer: {
      issue: async (input) => {
        const result = await createAirDeviceCallRoomToken(input);
        if (!result.ok) throw new Error("Air device room access is unavailable");
        return {
          wsUrl: result.wsUrl,
          token: result.token,
          expiresAt: result.expiresAt,
        };
      },
    },
  });
  const runtime: AgentCallTelephonyRuntime = {
    provider: "air780_volte",
    adapter,
    timeoutMs: gateway.config.timeoutMs,
    buildPayload: async ({ draft, call }) => {
      const phoneNumberReference = toAgentCallE164Phone(draft.targetPhone!);
      if (!phoneNumberReference) {
        throw new Error("Air780 requires an E.164-capable phone number");
      }
      const lease = await repository.postgres.airDeviceRegistry.claim({
        communicationSessionId: call.sessionId,
        leaseId: stableLeaseId(call.sessionId),
        ownerId: `${process.env.INSTANCE_ID ?? `api-${process.pid}`}:agent:${draft.id}`,
        ttlSeconds: deviceLeaseTtlSeconds(),
        heartbeatFreshnessSeconds: deviceHeartbeatFreshnessSeconds(),
      });
      if (!Number.isSafeInteger(lease.fencingToken) ||
        lease.fencingToken < 1 || lease.fencingToken > 0xffffffff) {
        throw new DeviceLeaseConflict("Air device fence cannot be a call generation");
      }
      return {
        communicationSessionId: call.sessionId,
        transport: "air780_volte",
        callGeneration: lease.fencingToken,
        roomName: call.roomName,
        phoneNumberReference,
        participantIdentity: `${call.sessionId}:guest:air:${lease.deviceId}`,
        deviceLease: {
          deviceId: lease.deviceId,
          leaseId: lease.leaseId,
          fencingToken: lease.fencingToken,
        },
      };
    },
    resolveParticipantBinding: async ({ call, operation }) => {
      const recorded = await repository.postgres.airDeviceCalls.findActiveBinding({
        communicationSessionId: call.sessionId,
        providerOperationId: operation.id,
      });
      if (recorded) return recorded;
      const lease = await repository.postgres.airDeviceRegistry.findActiveLease(
        call.sessionId,
      );
      if (!lease || lease.fencingToken > 0xffffffff) {
        throw new DeviceLeaseConflict("Air device participant lease is unavailable");
      }
      return {
        providerCallId: airDeviceProviderCallId(operation.id),
        participantIdentity: `${call.sessionId}:guest:air:${lease.deviceId}`,
        callGeneration: lease.fencingToken,
        deviceLease: leaseBinding(lease),
      };
    },
    resolveControlPayload: async ({ call, operation, action }) => {
      const binding = await repository.postgres.airDeviceCalls.findActiveBinding({
        communicationSessionId: call.sessionId,
        providerOperationId: operation.id,
      });
      if (!binding) {
        throw new DeviceLeaseConflict("Air device call binding is unavailable");
      }
      if (action === "dtmf" && binding.carrierState !== "connected") {
        throw new DeviceLeaseConflict("Air device call is not connected");
      }
      return {
        communicationSessionId: call.sessionId,
        providerCallId: binding.providerCallId,
        callGeneration: binding.callGeneration,
        deviceLease: binding.deviceLease,
      };
    },
    isCarrierConnected: async ({ call, operation }) => {
      const binding = await repository.postgres.airDeviceCalls.findActiveBinding({
        communicationSessionId: call.sessionId,
        providerOperationId: operation.id,
      });
      return binding?.carrierState === "connected";
    },
    releasePayload: async (payload) => {
      if (!payload.deviceLease) return;
      await repository.postgres.airDeviceRegistry.release({
        ...payload.deviceLease,
        heartbeatFreshnessSeconds: deviceHeartbeatFreshnessSeconds(),
      });
    },
  };
  return { ok: true as const, runtime };
}

export async function isAgentCallCarrierConnected(
  call: CallLinkRecord,
  operation: ProviderOperationRecord,
) {
  if (operation.provider === "livekit_sip") {
    return operation.status === "active";
  }
  if (operation.provider !== "air780_volte") return false;
  const telephony = getAgentCallTelephonyRuntime("air780_volte");
  if (!telephony.ok || !telephony.runtime.isCarrierConnected) return false;
  try {
    return await telephony.runtime.isCarrierConnected({ call, operation });
  } catch {
    return false;
  }
}

function leaseBinding(lease: {
  deviceId: string;
  leaseId: string;
  fencingToken: number;
}): DeviceLeaseBinding {
  return {
    deviceId: lease.deviceId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
  };
}

function stableLeaseId(sessionId: string) {
  return `lease_${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

function deviceLeaseTtlSeconds() {
  return boundedInteger(process.env.AIR_DEVICE_LEASE_TTL_SECONDS, 60, 15, 300);
}

function deviceHeartbeatFreshnessSeconds() {
  return boundedInteger(
    process.env.AIR_DEVICE_HEARTBEAT_FRESHNESS_SECONDS,
    30,
    5,
    300,
  );
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
