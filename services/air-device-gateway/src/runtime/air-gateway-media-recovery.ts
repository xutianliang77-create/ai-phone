import type {
  AirDeviceMediaRecoveryAccessDto,
  AirDeviceMediaRecoveryRequest,
} from "@translation/contracts";
import type { AirDeviceBootAdmissionSnapshot } from
  "../device/air-device-boot-admission.js";
import type { AirDeviceSessionBinding } from
  "../device/device-session-router.js";
import type { AirGatewayRoomRequest } from "./air-gateway-room-request.js";

/** Restores the exact active generation after USB/process recovery, never DIAL. */
export class AirGatewayMediaRecovery {
  private current?: Promise<void>;
  private currentKey?: string;
  private stopped = false;
  private readonly counters = {
    attempts: 0,
    duplicateHeartbeats: 0,
    staleResponses: 0,
    recoveries: 0,
    failures: 0,
    rollbacks: 0,
  };

  constructor(private readonly dependencies: {
    requestAccess(input: AirDeviceMediaRecoveryRequest):
      Promise<AirDeviceMediaRecoveryAccessDto>;
    isRecovered(binding: AirDeviceSessionBinding): boolean;
    isStillAuthoritative(binding: AirDeviceSessionBinding, bootId: string): boolean;
    restoreDevice(binding: AirDeviceSessionBinding): boolean | Promise<boolean>;
    restoreCarrier(
      binding: AirDeviceSessionBinding,
      state: AirDeviceMediaRecoveryAccessDto["carrierState"],
    ): void;
    prepareRoom(request: AirGatewayRoomRequest): Promise<boolean>;
    rollbackDevice(binding: AirDeviceSessionBinding): void | Promise<void>;
  }) {}

  observe(snapshot: AirDeviceBootAdmissionSnapshot) {
    if (this.stopped) return;
    const binding = snapshot.heartbeat?.activeBinding;
    const bootId = snapshot.bootId;
    if (!binding || !bootId || snapshot.heartbeat?.deviceState !== "in_call") {
      return;
    }
    if (this.dependencies.isRecovered(binding)) return;
    const key = bindingKey(binding);
    if (this.current) {
      if (this.currentKey === key) this.counters.duplicateHeartbeats += 1;
      return;
    }
    this.counters.attempts += 1;
    this.currentKey = key;
    const current = this.recover(binding, bootId);
    this.current = current;
    void current.finally(() => {
      if (this.current === current) {
        this.current = undefined;
        this.currentKey = undefined;
      }
    });
  }

  async flush() {
    await this.current?.catch(() => undefined);
  }

  async stop() {
    this.stopped = true;
    await this.flush();
  }

  metrics() {
    return { ...this.counters, recovering: Boolean(this.current) };
  }

  private async recover(binding: AirDeviceSessionBinding, bootId: string) {
    let deviceRestored = false;
    try {
      const access = await this.dependencies.requestAccess(binding);
      if (this.stopped || !sameBinding(access, binding) ||
        !this.dependencies.isStillAuthoritative(binding, bootId)) {
        this.counters.staleResponses += 1;
        return;
      }
      deviceRestored = await this.dependencies.restoreDevice(binding);
      this.dependencies.restoreCarrier(binding, access.carrierState);
      await this.dependencies.prepareRoom(roomRequest(access));
      this.counters.recoveries += 1;
    } catch {
      this.counters.failures += 1;
      if (deviceRestored) {
        this.counters.rollbacks += 1;
        try {
          await this.dependencies.rollbackDevice(binding);
        } catch {
          // Recovery remains fail-closed even when cleanup reporting fails.
        }
      }
    }
  }
}

function roomRequest(
  access: AirDeviceMediaRecoveryAccessDto,
): AirGatewayRoomRequest {
  return {
    communicationSessionId: access.communicationSessionId,
    providerCallId: access.providerCallId,
    deviceId: access.deviceId,
    leaseId: access.leaseId,
    fencingToken: access.fencingToken,
    callGeneration: access.callGeneration,
    roomName: access.roomName,
    participantIdentity: access.participantIdentity,
    roomAccess: { ...access.roomAccess },
  };
}

function sameBinding(
  left: AirDeviceMediaRecoveryRequest,
  right: AirDeviceSessionBinding,
) {
  return left.communicationSessionId === right.communicationSessionId &&
    left.providerCallId === right.providerCallId &&
    left.deviceId === right.deviceId && left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.callGeneration === right.callGeneration;
}

function bindingKey(binding: AirDeviceSessionBinding) {
  return [binding.communicationSessionId, binding.providerCallId,
    binding.deviceId, binding.leaseId, binding.fencingToken,
    binding.callGeneration].join("\u001f");
}
