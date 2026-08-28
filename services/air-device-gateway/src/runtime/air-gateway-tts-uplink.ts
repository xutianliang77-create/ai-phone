import type { AirDeviceSessionBinding } from
  "../device/device-session-router.js";
import type { AirDeviceUplinkSource } from "@translation/contracts";
import { VuartFrameType, type VuartFrame } from "../device/vuart-frame.js";
import { encodeVuartV1AudioPayload } from
  "../device/vuart-v1-payload.js";

const SAMPLE_RATE_HZ = 16_000 as const;
const SAMPLES_PER_FRAME = 320;
const FRAMES_PER_CHUNK = 10;

export interface SessionBoundTtsFrame extends AirDeviceSessionBinding {
  uplinkSource: AirDeviceUplinkSource;
  samples: Int16Array;
  sampleRate: 16_000;
}

type Rejection = "inactive_generation" | "stale_generation" |
  "binding_mismatch" | "carrier_not_connected" | "unsupported_format" |
  "backpressure" | "source_conflict";

interface PendingChunk {
  binding: AirDeviceSessionBinding;
  uplinkSource: AirDeviceUplinkSource;
  mediaSequence: number;
  payload: Uint8Array;
}

export class AirGatewayTtsUplink {
  private active?: AirDeviceSessionBinding;
  private latestGeneration = -1;
  private ready = false;
  private epoch = 0;
  private nextMediaSequence = 0;
  private activeUplinkSource?: AirDeviceUplinkSource;
  private partial: Int16Array[] = [];
  private readonly chunks: PendingChunk[] = [];
  private writing = false;
  private draining?: Promise<void>;
  private readonly capacityChunks: number;
  private readonly counters = {
    acceptedFrames: 0,
    invalidFrames: 0,
    bindingMismatches: 0,
    staleGenerationFrames: 0,
    carrierRejections: 0,
    assembledChunks: 0,
    writtenChunks: 0,
    writeFailures: 0,
    backpressureEvents: 0,
    droppedChunks: 0,
    droppedFrames: 0,
    clearedPartialFrames: 0,
    clearedQueuedChunks: 0,
    suspensions: 0,
    sourceSwitches: 0,
    sourceConflicts: 0,
    sourceBoundaryClears: 0,
    translatedTtsFrames: 0,
    takeoverMicrophoneFrames: 0,
  };

  constructor(private readonly dependencies: {
    transport: {
      writeFrame(input: Omit<VuartFrame, "version">): Promise<void>;
    };
    nextFrameSequence: () => number;
    nowMs?: () => bigint;
    currentBinding: () => AirDeviceSessionBinding | undefined;
    carrierConnected: (binding: AirDeviceSessionBinding) => boolean;
    capacityChunks?: number;
  }) {
    this.capacityChunks = dependencies.capacityChunks ?? 5;
    if (!Number.isInteger(this.capacityChunks) || this.capacityChunks < 1) {
      throw new Error("TTS uplink capacityChunks must be positive");
    }
  }

  resume(binding: AirDeviceSessionBinding) {
    if (binding.callGeneration < this.latestGeneration) {
      throw new Error("TTS uplink callGeneration is stale");
    }
    if (binding.callGeneration === this.latestGeneration) {
      if (!this.active || !sameBinding(binding, this.active)) {
        throw new Error("TTS uplink generation binding conflict");
      }
      this.clearPending();
    } else {
      this.clearPending();
      this.active = { ...binding };
      this.latestGeneration = binding.callGeneration;
      this.nextMediaSequence = 0;
    }
    this.activeUplinkSource = undefined;
    this.ready = true;
  }

  suspend(callGeneration?: number) {
    if (!this.active || (callGeneration !== undefined &&
      callGeneration !== this.active.callGeneration)) return false;
    this.ready = false;
    this.epoch += 1;
    this.counters.suspensions += 1;
    this.clearPending();
    this.activeUplinkSource = undefined;
    return true;
  }

  discardPending(binding: AirDeviceSessionBinding) {
    if (!this.active || !sameBinding(binding, this.active)) return false;
    this.counters.sourceBoundaryClears += 1;
    this.clearPending();
    this.activeUplinkSource = undefined;
    return true;
  }

  accept(input: SessionBoundTtsFrame):
    | { accepted: true; chunkQueued: boolean; mediaSequence?: number }
    | { accepted: false; reason: Rejection } {
    const rejection = this.bindingRejection(input);
    if (rejection) return { accepted: false, reason: rejection };
    if (!(input.samples instanceof Int16Array) ||
      input.sampleRate !== SAMPLE_RATE_HZ ||
      input.samples.length !== SAMPLES_PER_FRAME) {
      this.counters.invalidFrames += 1;
      return { accepted: false, reason: "unsupported_format" };
    }
    if (!this.dependencies.carrierConnected(this.active!)) {
      this.counters.carrierRejections += 1;
      return { accepted: false, reason: "carrier_not_connected" };
    }

    if (this.activeUplinkSource === "takeover_microphone" &&
      input.uplinkSource !== "takeover_microphone") {
      this.counters.sourceConflicts += 1;
      return { accepted: false, reason: "source_conflict" };
    }
    if (this.activeUplinkSource &&
      this.activeUplinkSource !== input.uplinkSource) {
      this.counters.sourceSwitches += 1;
      this.clearPending();
    }
    this.activeUplinkSource = input.uplinkSource;

    this.partial.push(Int16Array.from(input.samples));
    this.counters.acceptedFrames += 1;
    if (input.uplinkSource === "translated_tts") {
      this.counters.translatedTtsFrames += 1;
    } else {
      this.counters.takeoverMicrophoneFrames += 1;
    }
    if (this.partial.length < FRAMES_PER_CHUNK) {
      return { accepted: true, chunkQueued: false };
    }
    const mediaSequence = this.nextMediaSequence++ >>> 0;
    const payload = framesToPcm(this.partial);
    this.partial = [];
    this.counters.assembledChunks += 1;
    if (this.outstandingChunks() >= this.capacityChunks) {
      this.counters.backpressureEvents += 1;
      this.counters.droppedChunks += 1;
      this.counters.droppedFrames += FRAMES_PER_CHUNK;
      return { accepted: false, reason: "backpressure" };
    }
    this.chunks.push({
      binding: { ...this.active! },
      uplinkSource: input.uplinkSource,
      mediaSequence,
      payload,
    });
    this.startDrain();
    return { accepted: true, chunkQueued: true, mediaSequence };
  }

  flush() {
    return this.draining ?? Promise.resolve();
  }

  metrics() {
    return {
      ...this.counters,
      ready: this.ready,
      activeGeneration: this.active?.callGeneration,
      activeUplinkSource: this.activeUplinkSource,
      partialFrames: this.partial.length,
      queuedChunks: this.chunks.length,
      outstandingChunks: this.outstandingChunks(),
      nextMediaSequence: this.nextMediaSequence,
    };
  }

  private bindingRejection(input: AirDeviceSessionBinding): Rejection | null {
    if (this.active && input.callGeneration < this.active.callGeneration) {
      this.counters.staleGenerationFrames += 1;
      return "stale_generation";
    }
    if (!this.ready || !this.active) return "inactive_generation";
    if (!sameBinding(input, this.active) ||
      !sameBinding(this.dependencies.currentBinding() ?? {}, this.active)) {
      this.counters.bindingMismatches += 1;
      return "binding_mismatch";
    }
    return null;
  }

  private startDrain() {
    if (!this.ready || this.draining) return;
    const draining = this.drain(this.epoch);
    this.draining = draining;
    void draining.finally(() => {
      if (this.draining !== draining) return;
      this.draining = undefined;
      if (this.ready && this.chunks.length > 0) this.startDrain();
    }).catch(() => undefined);
  }

  private async drain(epoch: number) {
    while (this.ready && epoch === this.epoch) {
      const chunk = this.chunks.shift();
      if (!chunk) return;
      if (!this.active || !sameBinding(chunk.binding, this.active) ||
        chunk.uplinkSource !== this.activeUplinkSource ||
        !sameBinding(this.dependencies.currentBinding() ?? {}, this.active)) {
        this.counters.droppedChunks += 1;
        this.counters.droppedFrames += FRAMES_PER_CHUNK;
        continue;
      }
      this.writing = true;
      try {
        await this.dependencies.transport.writeFrame({
          type: VuartFrameType.AUDIO_UPLINK,
          flags: 0,
          sequence: this.dependencies.nextFrameSequence(),
          timestampMs: this.dependencies.nowMs?.() ?? BigInt(Date.now()),
          payload: encodeVuartV1AudioPayload({
            ...chunk.binding,
            mediaSequence: chunk.mediaSequence,
            payload: chunk.payload,
          }),
        });
        this.counters.writtenChunks += 1;
      } catch {
        this.counters.writeFailures += 1;
        this.counters.droppedChunks += 1;
        this.counters.droppedFrames += FRAMES_PER_CHUNK;
        this.suspend(chunk.binding.callGeneration);
        return;
      } finally {
        this.writing = false;
      }
    }
  }

  private outstandingChunks() {
    return this.chunks.length + (this.writing ? 1 : 0);
  }

  private clearPending() {
    this.epoch += 1;
    this.counters.clearedPartialFrames += this.partial.length;
    this.counters.clearedQueuedChunks += this.chunks.length;
    this.partial = [];
    this.chunks.length = 0;
  }
}

function framesToPcm(frames: Int16Array[]) {
  const output = new Uint8Array(
    FRAMES_PER_CHUNK * SAMPLES_PER_FRAME * Int16Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(output.buffer);
  let sampleIndex = 0;
  for (const frame of frames) {
    for (const sample of frame) {
      view.setInt16(sampleIndex * 2, sample, true);
      sampleIndex += 1;
    }
  }
  return output;
}

function sameBinding(
  left: Partial<AirDeviceSessionBinding>,
  right: AirDeviceSessionBinding,
) {
  return left.communicationSessionId === right.communicationSessionId &&
    left.providerCallId === right.providerCallId &&
    left.deviceId === right.deviceId && left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.callGeneration === right.callGeneration;
}
