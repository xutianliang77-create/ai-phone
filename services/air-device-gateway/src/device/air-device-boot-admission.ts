import type { AirDeviceSessionBinding } from "./device-session-router.js";
import {
  airDeviceBootAdmissionPolicy,
  airDeviceBootInvalidPayloadReason,
  airDeviceHelloPolicyRejection,
  type AirDeviceBootAdmissionPolicy,
  type AirDeviceBootInvalidFrameReason,
} from "./air-device-boot-diagnostics.js";
import {
  decodeVuartV1HeartbeatPayload,
  decodeVuartV1HelloPayload,
  VuartV1Capability,
  type VuartV1DeviceCommand,
  type VuartV1HeartbeatPayload,
  type VuartV1HelloPayload,
} from "./vuart-v1-command-payload.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";

export type AirDeviceBootAdmissionState =
  | "quarantined"
  | "reconciling"
  | "admitted";

export type AirDeviceCommandBlockReason =
  | "boot_not_admitted"
  | "binding_mismatch"
  | "device_not_ready"
  | "capability_missing";

export interface AirDeviceBootAdmissionSnapshot {
  state: AirDeviceBootAdmissionState;
  bootId?: string;
  hello?: VuartV1HelloPayload;
  heartbeat?: VuartV1HeartbeatPayload;
  heartbeatAgeMs?: number;
  authorizedBinding?: AirDeviceSessionBinding;
  bootChanges: number;
  staleBootFrames: number;
  staleHeartbeats: number;
  invalidFrames: number;
  invalidFrameReasons: Partial<Record<AirDeviceBootInvalidFrameReason, number>>;
  lastInvalidFrameReason?: AirDeviceBootInvalidFrameReason;
  reconcileCompletions: number;
  disconnects: number;
}

/**
 * Requires each device boot to be reconciled against authoritative host state
 * before a command can reach serial transport.
 */
export class AirDeviceBootAdmission {
  private state: AirDeviceBootAdmissionState = "quarantined";
  private hello?: VuartV1HelloPayload;
  private heartbeat?: VuartV1HeartbeatPayload;
  private heartbeatObservedAtMs?: number;
  private authorizedBinding?: AirDeviceSessionBinding;
  private readonly heartbeatTimeoutMs: number;
  private readonly nowMs: () => number;
  private readonly policy: AirDeviceBootAdmissionPolicy;
  private readonly retiredBootIds: string[] = [];
  private readonly revocationListeners = new Set<() => void>();
  private readonly unsubscribeFrame?: () => void;
  private readonly unsubscribeDisconnect?: () => void;
  private readonly counters = {
    bootChanges: 0,
    staleBootFrames: 0,
    staleHeartbeats: 0,
    invalidFrames: 0,
    reconcileCompletions: 0,
    disconnects: 0,
  };
  private readonly invalidFrameReasons: Partial<
    Record<AirDeviceBootInvalidFrameReason, number>
  > = {};
  private lastInvalidFrameReason?: AirDeviceBootInvalidFrameReason;

  constructor(private readonly options: {
    expectedDeviceId: string;
    onReconcileRequired?: (snapshot: AirDeviceBootAdmissionSnapshot) => void;
    onHeartbeatAccepted?: (snapshot: AirDeviceBootAdmissionSnapshot) => void;
    heartbeatTimeoutMs?: number;
    requiredCapabilityFlags?: number;
    minimumMaxPayloadBytes?: number;
    nowMs?: () => number;
    frameSource?: {
      onFrame(listener: (frame: VuartFrame) => void): () => void;
      onDisconnect(listener: (reason: string) => void): () => void;
    };
  }) {
    if (!options.expectedDeviceId) throw new Error("expectedDeviceId is required");
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15_000;
    this.nowMs = options.nowMs ?? Date.now;
    this.policy = airDeviceBootAdmissionPolicy(options);
    if (!Number.isInteger(this.heartbeatTimeoutMs) ||
      this.heartbeatTimeoutMs < 1) {
      throw new Error("heartbeatTimeoutMs must be a positive integer");
    }
    this.unsubscribeFrame = options.frameSource?.onFrame((frame) => this.observe(frame));
    this.unsubscribeDisconnect = options.frameSource?.onDisconnect((reason) =>
      this.disconnect(reason));
  }

  observe(frame: VuartFrame) {
    if (frame.flags !== 0) {
      this.recordInvalidFrame("frame_flags_unsupported");
      return;
    }
    try {
      if (frame.type === VuartFrameType.HELLO) {
        this.observeHello(decodeVuartV1HelloPayload(frame.payload));
      } else if (frame.type === VuartFrameType.HEARTBEAT) {
        this.observeHeartbeat(decodeVuartV1HeartbeatPayload(frame.payload));
      }
    } catch (error) {
      this.recordInvalidFrame(airDeviceBootInvalidPayloadReason(frame.type, error));
    }
  }

  completeReconcile(input: {
    bootId: string;
    authorizedBinding: AirDeviceSessionBinding;
  }) {
    assertBinding(input.authorizedBinding);
    if (!this.hello || input.bootId !== this.hello.bootId) {
      throw new Error("Cannot reconcile a different device boot");
    }
    if (!this.heartbeat || this.heartbeat.bootId !== input.bootId) {
      throw new Error("Cannot reconcile without a current heartbeat");
    }
    if (!this.heartbeatIsFresh()) {
      throw new Error("Cannot reconcile with a stale heartbeat");
    }
    if (input.authorizedBinding.deviceId !== this.options.expectedDeviceId) {
      throw new Error("Authoritative binding device mismatch");
    }
    if (this.heartbeat.deviceState !== "ready" &&
      this.heartbeat.deviceState !== "in_call") {
      throw new Error("Device state is not ready for admission");
    }
    if (this.heartbeat.deviceState === "in_call" &&
      (!this.heartbeat.activeBinding ||
        !sameBinding(this.heartbeat.activeBinding, input.authorizedBinding))) {
      this.state = "reconciling";
      throw new Error("Heartbeat binding does not match authoritative binding");
    }
    this.authorizedBinding = { ...input.authorizedBinding };
    this.state = "admitted";
    this.counters.reconcileCompletions += 1;
  }

  disconnect(_reason: string) {
    this.counters.disconnects += 1;
    this.heartbeat = undefined;
    this.heartbeatObservedAtMs = undefined;
    this.authorizedBinding = undefined;
    this.state = "quarantined";
    this.publishReconcileRequired();
  }

  onAdmissionRevoked(listener: () => void) {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  dispose() {
    this.unsubscribeFrame?.();
    this.unsubscribeDisconnect?.();
    this.revocationListeners.clear();
  }

  commandBlockReason(
    command: VuartV1DeviceCommand,
  ): AirDeviceCommandBlockReason | null {
    if (this.state !== "admitted" || !this.authorizedBinding) {
      return "boot_not_admitted";
    }
    if (this.heartbeat?.deviceState !== "ready" &&
      this.heartbeat?.deviceState !== "in_call") {
      return "device_not_ready";
    }
    if (!this.heartbeatIsFresh()) return "device_not_ready";
    if (!this.hello ||
      (this.hello.capabilityFlags & VuartV1Capability.CALL_CONTROL) === 0 ||
      (command.type === "dtmf" &&
        (this.hello.capabilityFlags & VuartV1Capability.DTMF) === 0)) {
      return "capability_missing";
    }
    if (command.type !== "dial" && this.heartbeat.deviceState !== "in_call") {
      return "device_not_ready";
    }
    if (!sameBinding(command, this.authorizedBinding)) {
      return "binding_mismatch";
    }
    return null;
  }

  snapshot(): AirDeviceBootAdmissionSnapshot {
    return {
      state: this.state,
      ...(this.hello ? { bootId: this.hello.bootId, hello: cloneHello(this.hello) } : {}),
      ...(this.heartbeat ? { heartbeat: cloneHeartbeat(this.heartbeat) } : {}),
      ...(this.heartbeatObservedAtMs === undefined
        ? {}
        : { heartbeatAgeMs: this.heartbeatAgeMs() }),
      ...(this.authorizedBinding
        ? { authorizedBinding: { ...this.authorizedBinding } }
        : {}),
      ...this.counters,
      invalidFrameReasons: { ...this.invalidFrameReasons },
      ...(this.lastInvalidFrameReason
        ? { lastInvalidFrameReason: this.lastInvalidFrameReason }
        : {}),
    };
  }

  private observeHello(hello: VuartV1HelloPayload) {
    const policyRejection = airDeviceHelloPolicyRejection(hello, this.policy);
    if (policyRejection) {
      this.recordInvalidFrame(policyRejection);
      return;
    }
    if (hello.deviceId !== this.options.expectedDeviceId) {
      this.recordInvalidFrame("device_identity_mismatch");
      return;
    }
    if (this.retiredBootIds.includes(hello.bootId)) {
      this.counters.staleBootFrames += 1;
      return;
    }
    if (this.hello?.bootId === hello.bootId) {
      if (!sameHello(this.hello, hello)) {
        this.recordInvalidFrame("hello_changed_within_boot");
        this.heartbeat = undefined;
        this.heartbeatObservedAtMs = undefined;
        this.authorizedBinding = undefined;
        this.state = "quarantined";
        this.publishReconcileRequired();
        return;
      }
      this.hello = cloneHello(hello);
      return;
    }
    if (this.hello) {
      this.counters.bootChanges += 1;
      this.retiredBootIds.push(this.hello.bootId);
      if (this.retiredBootIds.length > 16) this.retiredBootIds.shift();
    }
    this.hello = cloneHello(hello);
    this.heartbeat = undefined;
    this.heartbeatObservedAtMs = undefined;
    this.authorizedBinding = undefined;
    this.state = "quarantined";
    this.publishReconcileRequired();
  }

  private observeHeartbeat(heartbeat: VuartV1HeartbeatPayload) {
    if (heartbeat.deviceId !== this.options.expectedDeviceId) {
      this.recordInvalidFrame("device_identity_mismatch");
      return;
    }
    if (!this.hello || heartbeat.bootId !== this.hello.bootId) {
      this.counters.staleBootFrames += 1;
      return;
    }
    if (this.heartbeat &&
      (heartbeat.heartbeatSequence <= this.heartbeat.heartbeatSequence ||
        heartbeat.uptimeMs < this.heartbeat.uptimeMs)) {
      this.counters.staleHeartbeats += 1;
      return;
    }
    this.heartbeat = cloneHeartbeat(heartbeat);
    this.heartbeatObservedAtMs = this.nowMs();
    if (this.state === "admitted") {
      if (heartbeat.deviceState === "fault" ||
        heartbeat.deviceState === "quarantined" ||
        (heartbeat.deviceState === "in_call" &&
          (!heartbeat.activeBinding || !this.authorizedBinding ||
            !sameBinding(heartbeat.activeBinding, this.authorizedBinding)))) {
        this.state = "reconciling";
        this.authorizedBinding = undefined;
        this.publishReconcileRequired();
      }
      this.options.onHeartbeatAccepted?.(this.snapshot());
      return;
    }
    this.state = "reconciling";
    this.publishReconcileRequired();
    this.options.onHeartbeatAccepted?.(this.snapshot());
  }

  private publishReconcileRequired() {
    for (const listener of this.revocationListeners) listener();
    this.options.onReconcileRequired?.(this.snapshot());
  }

  private heartbeatIsFresh() {
    return this.heartbeatObservedAtMs !== undefined &&
      this.heartbeatAgeMs() <= this.heartbeatTimeoutMs;
  }

  private heartbeatAgeMs() {
    return Math.max(0, this.nowMs() - (this.heartbeatObservedAtMs ?? this.nowMs()));
  }

  private recordInvalidFrame(reason: AirDeviceBootInvalidFrameReason) {
    this.counters.invalidFrames += 1;
    this.invalidFrameReasons[reason] = (this.invalidFrameReasons[reason] ?? 0) + 1;
    this.lastInvalidFrameReason = reason;
  }
}

function sameBinding(left: AirDeviceSessionBinding, right: AirDeviceSessionBinding) {
  return left.communicationSessionId === right.communicationSessionId &&
    left.providerCallId === right.providerCallId &&
    left.deviceId === right.deviceId &&
    left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.callGeneration === right.callGeneration;
}

function assertBinding(input: AirDeviceSessionBinding) {
  if (![input.communicationSessionId, input.providerCallId, input.deviceId,
    input.leaseId].every((value) => typeof value === "string" && value.length > 0) ||
    !Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1 ||
    !Number.isInteger(input.callGeneration) || input.callGeneration < 0 ||
    input.callGeneration > 0xffffffff) {
    throw new Error("Invalid authoritative binding");
  }
}

function sameHello(left: VuartV1HelloPayload, right: VuartV1HelloPayload) {
  return left.deviceId === right.deviceId && left.bootId === right.bootId &&
    left.firmwareVersion === right.firmwareVersion &&
    left.protocolVersion === right.protocolVersion &&
    left.capabilityFlags === right.capabilityFlags &&
    left.maxPayloadBytes === right.maxPayloadBytes;
}

function cloneHello(input: VuartV1HelloPayload): VuartV1HelloPayload {
  return { ...input };
}

function cloneHeartbeat(input: VuartV1HeartbeatPayload): VuartV1HeartbeatPayload {
  return { ...input,
    ...(input.activeBinding ? { activeBinding: { ...input.activeBinding } } : {}) };
}
