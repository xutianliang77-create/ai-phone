import type { AirDeviceSessionBinding } from
  "../device/device-session-router.js";
import type { AirDeviceRoomClient } from
  "../media/livekit-device-participant.js";
import type { BoundedDeviceAudioQueue } from
  "../media/device-audio-queue.js";

export class AirGatewayAudioPump {
  private ready = false;
  private epoch = 0;
  private draining?: Promise<void>;
  private readonly counters = {
    publishedFrames: 0,
    droppedFrames: 0,
    staleGenerationFrames: 0,
    publishFailures: 0,
    suspensions: 0,
  };

  constructor(private readonly dependencies: {
    queue: Pick<BoundedDeviceAudioQueue, "dequeue" | "size">;
    currentBinding: () => AirDeviceSessionBinding | undefined;
    currentRoom: (binding: AirDeviceSessionBinding) =>
      AirDeviceRoomClient | null;
  }) {}

  resume() {
    this.ready = true;
    this.startDrain();
  }

  suspend() {
    this.ready = false;
    this.epoch += 1;
    this.counters.suspensions += 1;
  }

  notify() {
    this.startDrain();
  }

  flush() {
    return this.draining ?? Promise.resolve();
  }

  metrics() {
    return { ...this.counters, ready: this.ready,
      queuedFrames: this.dependencies.queue.size(),
      draining: Boolean(this.draining) };
  }

  private startDrain() {
    if (!this.ready || this.draining) return;
    const draining = this.drain(this.epoch);
    this.draining = draining;
    void draining.finally(() => {
      if (this.draining === draining) this.draining = undefined;
    });
  }

  private async drain(epoch: number) {
    while (this.ready && epoch === this.epoch) {
      const binding = this.dependencies.currentBinding();
      if (!binding) return;
      const room = this.dependencies.currentRoom(binding);
      if (!room) return;
      const frame = this.dependencies.queue.dequeue();
      if (!frame) return;
      if (frame.callGeneration !== binding.callGeneration) {
        this.counters.staleGenerationFrames += 1;
        this.counters.droppedFrames += 1;
        continue;
      }
      try {
        await room.publishPcmTrack(
          `air780-downlink-${binding.deviceId}`,
          pcmS16leSamples(frame.payload),
          16_000,
        );
        this.counters.publishedFrames += 1;
      } catch {
        this.counters.publishFailures += 1;
        this.counters.droppedFrames += 1;
        return;
      }
    }
  }
}

export function pcmS16leSamples(payload: Uint8Array) {
  if (payload.byteLength % 2 !== 0) {
    throw new Error("PCM S16LE payload must contain complete samples");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return Int16Array.from(
    { length: payload.byteLength / 2 },
    (_, index) => view.getInt16(index * 2, true),
  );
}
