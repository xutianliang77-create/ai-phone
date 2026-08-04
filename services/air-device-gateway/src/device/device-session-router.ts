import {
  type BoundedDeviceAudioQueue,
  type DeviceAudioQueueMetrics,
} from "../media/device-audio-queue.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";

export interface AirDeviceSessionBinding {
  communicationSessionId: string;
  providerCallId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
}

export interface SessionBoundAudioChunk extends AirDeviceSessionBinding {
  deviceSequence: number;
  payload: Uint8Array;
}

export type AirDeviceCarrierState =
  | "dialing"
  | "ringing"
  | "connected"
  | "disconnected"
  | "busy"
  | "failed"
  | "unknown";

export type AirDeviceCarrierCause =
  | "none"
  | "local_hangup"
  | "remote_hangup"
  | "busy"
  | "no_answer"
  | "rejected"
  | "network_error"
  | "device_error"
  | "unknown";

export interface SessionBoundCarrierState extends AirDeviceSessionBinding {
  carrierState: AirDeviceCarrierState;
  carrierCause: AirDeviceCarrierCause;
  eventSequence: number;
  deviceTimestampMs: bigint;
}

/**
 * The VUART v1 session payload profile is decoded outside the router. A decoder
 * must produce complete binding claims before media or carrier state is
 * accepted; the envelope alone is not a session boundary.
 */
export interface AirDevicePayloadDecoder {
  decodeAudio(frame: VuartFrame): SessionBoundAudioChunk | null;
  decodeCallState(frame: VuartFrame): SessionBoundCarrierState | null;
}

export interface AirDeviceSessionRouterMetrics {
  routedAudioChunks: number;
  carrierEvents: number;
  carrierSequenceGapEvents: number;
  missingCarrierEvents: number;
  duplicateCarrierEvents: number;
  outOfOrderCarrierEvents: number;
  droppedAudioChunks: number;
  invalidPayloads: number;
  bindingMismatches: number;
  unboundFrames: number;
  unsupportedFrames: number;
  terminalClears: number;
  disconnects: number;
}

type AudioRejection =
  | "unbound"
  | "invalid_payload"
  | "binding_mismatch"
  | "stale_generation"
  | "duplicate"
  | "out_of_order"
  | "backpressure";

type CarrierRejection =
  | "unbound"
  | "invalid_payload"
  | "binding_mismatch"
  | "duplicate"
  | "out_of_order";

export type AirDeviceRouteResult =
  | { accepted: true; kind: "audio"; framesEnqueued: number }
  | { accepted: false; kind: "audio"; reason: AudioRejection }
  | { accepted: true; kind: "carrier"; event: SessionBoundCarrierState }
  | { accepted: false; kind: "carrier"; reason: CarrierRejection }
  | { accepted: false; kind: "ignored"; reason: "unsupported_frame" };

export class AirDeviceSessionRouter {
  private activeBinding?: AirDeviceSessionBinding;
  private lastBinding?: AirDeviceSessionBinding;
  private latestGeneration = -1;
  private lastCarrierSequence?: number;
  private readonly counters: AirDeviceSessionRouterMetrics = {
    routedAudioChunks: 0,
    carrierEvents: 0,
    carrierSequenceGapEvents: 0,
    missingCarrierEvents: 0,
    duplicateCarrierEvents: 0,
    outOfOrderCarrierEvents: 0,
    droppedAudioChunks: 0,
    invalidPayloads: 0,
    bindingMismatches: 0,
    unboundFrames: 0,
    unsupportedFrames: 0,
    terminalClears: 0,
    disconnects: 0,
  };

  constructor(private readonly dependencies: {
    queue: BoundedDeviceAudioQueue;
    decoder: AirDevicePayloadDecoder;
    onCarrierEvent?: (event: SessionBoundCarrierState) => void;
  }) {}

  bind(input: AirDeviceSessionBinding) {
    assertBinding(input);
    if (input.callGeneration <= this.latestGeneration) {
      throw new Error("callGeneration must increase");
    }
    if (this.lastBinding) this.assertLeaseProgress(input, this.lastBinding);
    this.dependencies.queue.beginGeneration(input.callGeneration);
    this.activeBinding = { ...input };
    this.lastBinding = { ...input };
    this.latestGeneration = input.callGeneration;
    this.lastCarrierSequence = undefined;
  }

  route(frame: VuartFrame): AirDeviceRouteResult {
    if (frame.type === VuartFrameType.AUDIO_DOWNLINK) {
      return this.routeAudio(frame);
    }
    if (frame.type === VuartFrameType.CALL_STATE) {
      return this.routeCarrier(frame);
    }
    this.counters.unsupportedFrames += 1;
    return { accepted: false, kind: "ignored", reason: "unsupported_frame" };
  }

  disconnect(_reason: string) {
    this.counters.disconnects += 1;
    this.endActiveGeneration();
  }

  binding() {
    return this.activeBinding ? { ...this.activeBinding } : undefined;
  }

  metrics(): AirDeviceSessionRouterMetrics & {
    audioQueue: DeviceAudioQueueMetrics;
  } {
    return {
      ...this.counters,
      audioQueue: this.dependencies.queue.metrics(),
    };
  }

  private routeAudio(frame: VuartFrame): AirDeviceRouteResult {
    if (!this.activeBinding) return this.unbound("audio");
    const decoded = this.decode(() => this.dependencies.decoder.decodeAudio(frame));
    if (!isAudioChunk(decoded)) return this.invalidPayload("audio");
    if (!sameBinding(decoded, this.activeBinding)) {
      this.counters.bindingMismatches += 1;
      return { accepted: false, kind: "audio", reason: "binding_mismatch" };
    }
    try {
      const result = this.dependencies.queue.enqueue({
        payload: decoded.payload,
        deviceSequence: decoded.deviceSequence,
        callGeneration: decoded.callGeneration,
      });
      if (!result.accepted) {
        this.counters.droppedAudioChunks += 1;
        return { accepted: false, kind: "audio", reason: result.reason };
      }
      this.counters.routedAudioChunks += 1;
      return { accepted: true, kind: "audio", framesEnqueued: result.framesEnqueued };
    } catch {
      return this.invalidPayload("audio");
    }
  }

  private routeCarrier(frame: VuartFrame): AirDeviceRouteResult {
    if (!this.activeBinding) return this.unbound("carrier");
    const decoded = this.decode(() =>
      this.dependencies.decoder.decodeCallState(frame));
    if (!isCarrierState(decoded)) return this.invalidPayload("carrier");
    if (!sameBinding(decoded, this.activeBinding)) {
      this.counters.bindingMismatches += 1;
      return { accepted: false, kind: "carrier", reason: "binding_mismatch" };
    }
    if (decoded.eventSequence === this.lastCarrierSequence) {
      this.counters.duplicateCarrierEvents += 1;
      return { accepted: false, kind: "carrier", reason: "duplicate" };
    }
    if (this.lastCarrierSequence !== undefined &&
      decoded.eventSequence < this.lastCarrierSequence) {
      this.counters.outOfOrderCarrierEvents += 1;
      return { accepted: false, kind: "carrier", reason: "out_of_order" };
    }
    if (this.lastCarrierSequence !== undefined &&
      decoded.eventSequence > this.lastCarrierSequence + 1) {
      this.counters.carrierSequenceGapEvents += 1;
      this.counters.missingCarrierEvents +=
        decoded.eventSequence - this.lastCarrierSequence - 1;
    }
    this.lastCarrierSequence = decoded.eventSequence;
    this.counters.carrierEvents += 1;
    this.dependencies.onCarrierEvent?.(decoded);
    if (isTerminal(decoded.carrierState)) {
      this.counters.terminalClears += 1;
      this.endActiveGeneration();
    }
    return { accepted: true, kind: "carrier", event: decoded };
  }

  private decode<T>(operation: () => T | null) {
    try {
      return operation();
    } catch {
      return null;
    }
  }

  private invalidPayload(kind: "audio"): AirDeviceRouteResult;
  private invalidPayload(kind: "carrier"): AirDeviceRouteResult;
  private invalidPayload(kind: "audio" | "carrier"): AirDeviceRouteResult {
    this.counters.invalidPayloads += 1;
    return { accepted: false, kind, reason: "invalid_payload" };
  }

  private unbound(kind: "audio"): AirDeviceRouteResult;
  private unbound(kind: "carrier"): AirDeviceRouteResult;
  private unbound(kind: "audio" | "carrier"): AirDeviceRouteResult {
    this.counters.unboundFrames += 1;
    return { accepted: false, kind, reason: "unbound" };
  }

  private endActiveGeneration() {
    if (!this.activeBinding) return;
    this.dependencies.queue.endGeneration(this.activeBinding.callGeneration);
    this.activeBinding = undefined;
    this.lastCarrierSequence = undefined;
  }

  private assertLeaseProgress(
    input: AirDeviceSessionBinding,
    previous: AirDeviceSessionBinding,
  ) {
    if (input.deviceId !== previous.deviceId) {
      throw new Error("deviceId cannot change on a session router");
    }
    if (input.leaseId === previous.leaseId) {
      if (input.communicationSessionId !== previous.communicationSessionId) {
        throw new Error("leaseId cannot move to another communication session");
      }
      if (input.fencingToken < previous.fencingToken) {
        throw new Error("fencingToken cannot decrease");
      }
      return;
    }
    if (input.fencingToken <= previous.fencingToken) {
      throw new Error("fencingToken must increase for a new lease");
    }
  }
}

function sameBinding(
  decoded: AirDeviceSessionBinding,
  active: AirDeviceSessionBinding,
) {
  return decoded.communicationSessionId === active.communicationSessionId &&
    decoded.providerCallId === active.providerCallId &&
    decoded.deviceId === active.deviceId && decoded.leaseId === active.leaseId &&
    decoded.fencingToken === active.fencingToken &&
    decoded.callGeneration === active.callGeneration;
}

function assertBinding(input: AirDeviceSessionBinding) {
  if (!hasBinding(input) || !Number.isSafeInteger(input.fencingToken) ||
    input.fencingToken < 1 || !isUint32(input.callGeneration)) {
    throw new Error("Invalid Air device session binding");
  }
}

function hasBinding(input: Partial<AirDeviceSessionBinding>) {
  return [input.communicationSessionId, input.providerCallId, input.deviceId,
    input.leaseId].every((value) =>
      typeof value === "string" && value.trim().length > 0);
}

function isAudioChunk(value: unknown): value is SessionBoundAudioChunk {
  const input = value as Partial<SessionBoundAudioChunk> | null;
  return Boolean(input && hasBinding(input) &&
    Number.isSafeInteger(input.fencingToken) && input.fencingToken! >= 1 &&
    isUint32(input.callGeneration) && isUint32(input.deviceSequence) &&
    input.payload instanceof Uint8Array);
}

function isCarrierState(value: unknown): value is SessionBoundCarrierState {
  const input = value as Partial<SessionBoundCarrierState> | null;
  return Boolean(input && hasBinding(input) &&
    Number.isSafeInteger(input.fencingToken) && input.fencingToken! >= 1 &&
    isUint32(input.callGeneration) && isUint32(input.eventSequence) &&
    typeof input.deviceTimestampMs === "bigint" && input.deviceTimestampMs >= 0n &&
    validCarrierStateCause(input.carrierState, input.carrierCause));
}

function validCarrierStateCause(
  state: AirDeviceCarrierState | undefined,
  cause: AirDeviceCarrierCause | undefined,
) {
  if (!state || !cause) return false;
  const allowed: Record<AirDeviceCarrierState, AirDeviceCarrierCause[]> = {
    dialing: ["none"],
    ringing: ["none"],
    connected: ["none"],
    disconnected: ["local_hangup", "remote_hangup", "no_answer", "rejected",
      "unknown"],
    busy: ["busy"],
    failed: ["network_error", "device_error", "unknown"],
    unknown: ["unknown"],
  };
  return allowed[state]?.includes(cause) ?? false;
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 &&
    Number(value) <= 0xffffffff;
}

function isTerminal(state: AirDeviceCarrierState) {
  return state === "disconnected" || state === "busy" || state === "failed";
}
