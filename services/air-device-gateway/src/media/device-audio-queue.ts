const DEVICE_CHUNK_BYTES = 6_400;
const LIVEKIT_FRAME_BYTES = 640;
const SUBFRAMES_PER_CHUNK = 10;

export interface DevicePcmChunk {
  payload: Uint8Array;
  deviceSequence: number;
  callGeneration: number;
}

export interface LiveKitPcmFrame {
  payload: Uint8Array;
  deviceSequence: number;
  subframeIndex: number;
  callGeneration: number;
}

export interface DeviceAudioQueueMetrics {
  acceptedChunks: number;
  dequeuedFrames: number;
  sequenceGapEvents: number;
  missingDeviceChunks: number;
  duplicateChunks: number;
  outOfOrderChunks: number;
  backpressureEvents: number;
  droppedChunks: number;
  droppedFrames: number;
  staleGenerationChunks: number;
  clearedFrames: number;
}

export function rechunkDevicePcm(input: DevicePcmChunk): LiveKitPcmFrame[] {
  assertUint32(input.deviceSequence, "deviceSequence");
  assertUint32(input.callGeneration, "callGeneration");
  if (input.payload.byteLength !== DEVICE_CHUNK_BYTES) {
    throw new Error("Device PCM chunk must contain exactly 6400 bytes");
  }
  return Array.from({ length: SUBFRAMES_PER_CHUNK }, (_, subframeIndex) => ({
    payload: input.payload.slice(
      subframeIndex * LIVEKIT_FRAME_BYTES,
      (subframeIndex + 1) * LIVEKIT_FRAME_BYTES,
    ),
    deviceSequence: input.deviceSequence,
    subframeIndex,
    callGeneration: input.callGeneration,
  }));
}

export class BoundedDeviceAudioQueue {
  private activeGeneration?: number;
  private latestGeneration = -1;
  private lastDeviceSequence?: number;
  private readonly frames: LiveKitPcmFrame[] = [];
  private readonly counters: DeviceAudioQueueMetrics = {
    acceptedChunks: 0,
    dequeuedFrames: 0,
    sequenceGapEvents: 0,
    missingDeviceChunks: 0,
    duplicateChunks: 0,
    outOfOrderChunks: 0,
    backpressureEvents: 0,
    droppedChunks: 0,
    droppedFrames: 0,
    staleGenerationChunks: 0,
    clearedFrames: 0,
  };

  constructor(private readonly capacityFrames: number) {
    if (!Number.isInteger(capacityFrames) || capacityFrames < SUBFRAMES_PER_CHUNK) {
      throw new Error("capacityFrames must hold at least one device chunk");
    }
  }

  beginGeneration(callGeneration: number) {
    assertUint32(callGeneration, "callGeneration");
    if (callGeneration <= this.latestGeneration) {
      throw new Error("callGeneration must increase");
    }
    this.clearFrames();
    this.activeGeneration = callGeneration;
    this.latestGeneration = callGeneration;
    this.lastDeviceSequence = undefined;
  }

  endGeneration(callGeneration: number) {
    if (callGeneration !== this.activeGeneration) {
      throw new Error("Cannot end an inactive callGeneration");
    }
    this.clearFrames();
    this.activeGeneration = undefined;
    this.lastDeviceSequence = undefined;
  }

  enqueue(input: DevicePcmChunk):
    | { accepted: true; framesEnqueued: number }
    | { accepted: false; reason: "stale_generation" | "duplicate" |
        "out_of_order" | "backpressure" } {
    if (input.callGeneration !== this.activeGeneration) {
      this.counters.staleGenerationChunks += 1;
      return { accepted: false, reason: "stale_generation" };
    }
    const incomingFrames = rechunkDevicePcm(input);
    if (input.deviceSequence === this.lastDeviceSequence) {
      this.counters.duplicateChunks += 1;
      return { accepted: false, reason: "duplicate" };
    }
    if (this.lastDeviceSequence !== undefined &&
      input.deviceSequence < this.lastDeviceSequence) {
      this.counters.outOfOrderChunks += 1;
      return { accepted: false, reason: "out_of_order" };
    }
    if (this.lastDeviceSequence !== undefined &&
      input.deviceSequence > this.lastDeviceSequence + 1) {
      this.counters.sequenceGapEvents += 1;
      this.counters.missingDeviceChunks +=
        input.deviceSequence - this.lastDeviceSequence - 1;
    }
    this.lastDeviceSequence = input.deviceSequence;
    if (this.frames.length + incomingFrames.length > this.capacityFrames) {
      this.counters.backpressureEvents += 1;
      this.counters.droppedChunks += 1;
      this.counters.droppedFrames += incomingFrames.length;
      return { accepted: false, reason: "backpressure" };
    }
    this.frames.push(...incomingFrames);
    this.counters.acceptedChunks += 1;
    return { accepted: true, framesEnqueued: incomingFrames.length };
  }

  dequeue() {
    const frame = this.frames.shift();
    if (frame) this.counters.dequeuedFrames += 1;
    return frame;
  }

  size() {
    return this.frames.length;
  }

  metrics(): DeviceAudioQueueMetrics {
    return { ...this.counters };
  }

  private clearFrames() {
    this.counters.clearedFrames += this.frames.length;
    this.frames.length = 0;
  }
}

function assertUint32(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
}
