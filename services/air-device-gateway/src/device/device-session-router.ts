import {
  type BoundedDeviceAudioQueue,
  type DeviceAudioQueueMetrics,
} from "../media/device-audio-queue.js";
import {
  assertAirDeviceBinding,
  assertAirDeviceLeaseProgress,
  isSessionBoundAudioChunk,
  isSessionBoundCarrierState,
  isTerminalCarrierState,
  sameAirDeviceBinding,
} from "./device-session-binding.js";
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
  authoritativeRestores: number;
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
    authoritativeRestores: 0,
  };

  constructor(private readonly dependencies: {
    queue: BoundedDeviceAudioQueue;
    decoder: AirDevicePayloadDecoder;
    onCarrierEvent?: (event: SessionBoundCarrierState) => void;
  }) {}

  bind(input: AirDeviceSessionBinding) {
    assertAirDeviceBinding(input);
    if (input.callGeneration <= this.latestGeneration) {
      throw new Error("callGeneration must increase");
    }
    if (this.lastBinding) {
      assertAirDeviceLeaseProgress(input, this.lastBinding);
    }
    this.dependencies.queue.beginGeneration(input.callGeneration);
    this.activeBinding = { ...input };
    this.lastBinding = { ...input };
    this.latestGeneration = input.callGeneration;
    this.lastCarrierSequence = undefined;
  }

  /**
   * Restores the exact generation reported by both the board heartbeat and the
   * API's current-call binding. Unlike bind(), this never advances a call and
   * therefore cannot be used to redial after an uncertain disconnect.
   */
  restoreAuthoritative(input: AirDeviceSessionBinding) {
    assertAirDeviceBinding(input);
    if (this.activeBinding) {
      if (!sameAirDeviceBinding(input, this.activeBinding)) {
        throw new Error("Active Air device binding conflicts with recovery");
      }
      return false;
    }
    if (this.lastBinding && !sameAirDeviceBinding(input, this.lastBinding)) {
      throw new Error("Authoritative recovery must match the retired binding");
    }
    if (this.lastBinding && input.callGeneration !== this.latestGeneration) {
      throw new Error("Authoritative recovery generation is stale");
    }
    if (this.lastBinding) {
      this.dependencies.queue.restoreGeneration(input.callGeneration);
    } else {
      this.dependencies.queue.beginGeneration(input.callGeneration);
    }
    this.activeBinding = { ...input };
    this.lastBinding = { ...input };
    this.latestGeneration = Math.max(this.latestGeneration, input.callGeneration);
    this.lastCarrierSequence = undefined;
    this.counters.authoritativeRestores += 1;
    return true;
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
    if (!isSessionBoundAudioChunk(decoded)) return this.invalidPayload("audio");
    if (!sameAirDeviceBinding(decoded, this.activeBinding)) {
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
    if (!isSessionBoundCarrierState(decoded)) {
      return this.invalidPayload("carrier");
    }
    if (!sameAirDeviceBinding(decoded, this.activeBinding)) {
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
    if (isTerminalCarrierState(decoded.carrierState)) {
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

}
