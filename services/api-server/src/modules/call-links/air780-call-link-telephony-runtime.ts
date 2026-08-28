import { createHash } from "node:crypto";
import type {
  AirDeviceMediaPolicy,
  DeviceLeaseBinding,
  PhoneCallControlPayload,
  PlacePhoneCallPayload,
  TelephonyProvider,
} from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import { getAirDeviceGatewayConfig } from "../device-calls/air-device-gateway-readiness.js";
import {
  Air780DeviceProviderAdapter,
  airDeviceProviderCallId,
  type AirDeviceGatewayClient,
} from "../device-calls/air780-device-provider-adapter.js";
import { createAirDeviceCallRoomToken } from
  "../device-calls/device-call-room-token.js";
import { DeviceLeaseConflict } from "../device-calls/device-lease-registry.js";
import { HttpAirDeviceGatewayClient } from
  "../device-calls/http-air-device-gateway-client.js";
import type { CallLinkRecord } from "./call-links.service.js";

export interface Air780CallLinkTelephonyRuntime {
  adapter: TelephonyProvider;
  timeoutMs: number;
  buildPayload(input: {
    record: CallLinkRecord;
    operation: ProviderOperationRecord;
    targetPhone: string;
  }): Promise<PlacePhoneCallPayload>;
  resolveControlPayload(input: {
    record: CallLinkRecord;
    operation: ProviderOperationRecord;
    action: "dtmf" | "hangup";
  }): Promise<PhoneCallControlPayload>;
  releasePayload(payload: PlacePhoneCallPayload): Promise<void>;
}

let testRuntime: Air780CallLinkTelephonyRuntime | null = null;

export function setAir780CallLinkTelephonyRuntimeForTests(
  runtime: Air780CallLinkTelephonyRuntime | null,
) {
  testRuntime = runtime;
}

export function getAir780CallLinkTelephonyRuntime():
  | { ok: true; runtime: Air780CallLinkTelephonyRuntime }
  | { ok: false; issues: string[] } {
  if (testRuntime) return { ok: true, runtime: testRuntime };
  const gateway = getAirDeviceGatewayConfig();
  let repository;
  try {
    repository = getRepositoryRuntime();
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : "Repository runtime is unavailable"],
    };
  }
  if (!gateway.ok || repository.driver !== "postgres") {
    return {
      ok: false,
      issues: [
        ...(gateway.ok ? [] : gateway.issues),
        ...(repository.driver === "postgres"
          ? []
          : ["Air780 translation calls require API_STORAGE_DRIVER=postgres"]),
      ],
    };
  }
  const gatewayClient = new HttpAirDeviceGatewayClient(gateway.config);
  return {
    ok: true,
    runtime: createRuntime({
      gateway: gatewayClient,
      leaseVerifier: repository.postgres.airDeviceRegistry,
      callRecorder: repository.postgres.airDeviceCalls,
      roomAccessIssuer: {
        issue: async (input) => {
          const result = await createAirDeviceCallRoomToken(input);
          if (!result.ok) throw new Error("Air device room access is unavailable");
          return {
            wsUrl: result.wsUrl,
            token: result.token,
            expiresAt: result.expiresAt,
            mediaPolicy: result.mediaPolicy,
          };
        },
      },
      leaseRegistry: repository.postgres.airDeviceRegistry,
      timeoutMs: gateway.config.timeoutMs,
    }),
  };
}

function createRuntime(input: {
  gateway: AirDeviceGatewayClient;
  leaseVerifier: {
    assertLease(input: {
      deviceId: string;
      leaseId: string;
      fencingToken: number;
      nowMs: number;
    }): Promise<void> | void;
  };
  callRecorder: {
    recordDial(input: DeviceCallRecordInput): Promise<unknown>;
    recordDialRejected(input: DeviceCallRecordInput): Promise<unknown>;
    findActiveBinding(input: {
      communicationSessionId: string;
      providerOperationId: string;
    }): Promise<{
      providerCallId: string;
      callGeneration: number;
      deviceLease: DeviceLeaseBinding;
      carrierState: string;
    } | null>;
  };
  roomAccessIssuer: {
    issue(input: {
      communicationSessionId: string;
      roomName: string;
      deviceId: string;
      leaseId: string;
      callGeneration: number;
      mediaPolicy: AirDeviceMediaPolicy;
    }): Promise<{
      wsUrl: string;
      token: string;
      expiresAt: string;
      mediaPolicy: AirDeviceMediaPolicy;
    }>;
  };
  leaseRegistry: {
    claim(input: {
      communicationSessionId: string;
      leaseId: string;
      ownerId: string;
      ttlSeconds: number;
      heartbeatFreshnessSeconds: number;
    }): Promise<{
      deviceId: string;
      leaseId: string;
      fencingToken: number;
    }>;
    findActiveLease(communicationSessionId: string): Promise<{
      deviceId: string;
      leaseId: string;
      fencingToken: number;
    } | null>;
    release(input: {
      deviceId: string;
      leaseId: string;
      fencingToken: number;
      heartbeatFreshnessSeconds: number;
    }): Promise<unknown>;
  };
  timeoutMs: number;
}): Air780CallLinkTelephonyRuntime {
  const adapter = new Air780DeviceProviderAdapter({
    leaseVerifier: input.leaseVerifier,
    callRecorder: input.callRecorder,
    gateway: input.gateway,
    roomAccessIssuer: input.roomAccessIssuer,
  });
  return {
    adapter,
    timeoutMs: input.timeoutMs,
    buildPayload: async ({ record, operation, targetPhone }) => {
      const lease = await input.leaseRegistry.claim({
        communicationSessionId: record.sessionId,
        leaseId: stableLeaseId(record.sessionId),
        ownerId: `${process.env.INSTANCE_ID ?? `api-${process.pid}`}:translation:${operation.id}`,
        ttlSeconds: deviceLeaseTtlSeconds(),
        heartbeatFreshnessSeconds: deviceHeartbeatFreshnessSeconds(),
      });
      if (!Number.isSafeInteger(lease.fencingToken) ||
        lease.fencingToken < 1 || lease.fencingToken > 0xffffffff) {
        throw new DeviceLeaseConflict("Air device fence is invalid");
      }
      return {
        communicationSessionId: record.sessionId,
        transport: "air780_volte",
        callGeneration: lease.fencingToken,
        mediaPolicy: "translation_isolated",
        roomName: record.roomName,
        phoneNumberReference: targetPhone,
        participantIdentity: `${record.sessionId}:guest:air:${lease.deviceId}`,
        deviceLease: lease,
      };
    },
    resolveControlPayload: async ({ record, operation, action }) => {
      const binding = await input.callRecorder.findActiveBinding({
        communicationSessionId: record.sessionId,
        providerOperationId: operation.id,
      });
      if (binding) {
        if (action === "dtmf" && binding.carrierState !== "connected") {
          throw new DeviceLeaseConflict(
            "Air device call must be connected before DTMF",
          );
        }
        return {
          communicationSessionId: record.sessionId,
          providerCallId: binding.providerCallId,
          callGeneration: binding.callGeneration,
          deviceLease: binding.deviceLease,
        };
      }
      if (action === "dtmf") {
        throw new DeviceLeaseConflict(
          "Air device connected call binding is unavailable",
        );
      }
      const lease = await input.leaseRegistry.findActiveLease(record.sessionId);
      if (!lease) throw new DeviceLeaseConflict("Air device call binding is unavailable");
      return {
        communicationSessionId: record.sessionId,
        providerCallId: airDeviceProviderCallId(operation.id),
        callGeneration: lease.fencingToken,
        deviceLease: lease,
      };
    },
    releasePayload: async (payload) => {
      if (!payload.deviceLease) return;
      await input.leaseRegistry.release({
        ...payload.deviceLease,
        heartbeatFreshnessSeconds: deviceHeartbeatFreshnessSeconds(),
      });
    },
  };
}

interface DeviceCallRecordInput {
  providerCallId: string;
  providerOperationId: string;
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  roomName: string;
  participantIdentity: string;
  callGeneration: number;
  mediaPolicy: AirDeviceMediaPolicy;
}

function stableLeaseId(sessionId: string) {
  return `lease_${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

function deviceLeaseTtlSeconds() {
  return boundedInteger(process.env.AIR_DEVICE_LEASE_TTL_SECONDS, 60, 15, 300);
}

function deviceHeartbeatFreshnessSeconds() {
  return boundedInteger(process.env.AIR_DEVICE_HEARTBEAT_FRESHNESS_SECONDS, 30, 5, 300);
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
