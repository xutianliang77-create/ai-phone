import { describe, expect, it, vi } from "vitest";
import { BoundedDeviceAudioQueue } from "../media/device-audio-queue.js";
import type { AirDeviceRoomClient } from
  "../media/livekit-device-participant.js";
import {
  AirGatewayAudioPump,
  pcmS16leSamples,
} from "./air-gateway-audio-pump.js";

describe("Air Gateway audio pump", () => {
  it("publishes ten ordered 20ms frames for one device chunk", async () => {
    const fixture = setup();
    fixture.queue.beginGeneration(binding.callGeneration);
    const payload = pcmChunk();
    fixture.queue.enqueue({
      payload,
      deviceSequence: 9,
      callGeneration: binding.callGeneration,
    });

    fixture.pump.resume();
    await fixture.pump.flush();

    expect(fixture.publishPcmTrack).toHaveBeenCalledTimes(10);
    expect(fixture.publishPcmTrack).toHaveBeenCalledWith(
      "air780-downlink-air-780-1",
      expect.any(Int16Array),
      16_000,
    );
    const samples = fixture.publishPcmTrack.mock.calls.flatMap(([, frame]) =>
      [...frame]);
    expect(samples).toEqual([...pcmS16leSamples(payload)]);
    expect(fixture.pump.metrics()).toMatchObject({
      publishedFrames: 10,
      droppedFrames: 0,
      queuedFrames: 0,
    });
  });

  it("does not publish queued audio while suspended", async () => {
    const fixture = setup();
    fixture.queue.beginGeneration(binding.callGeneration);
    fixture.queue.enqueue({
      payload: pcmChunk(),
      deviceSequence: 1,
      callGeneration: binding.callGeneration,
    });

    fixture.pump.suspend();
    fixture.pump.notify();
    await fixture.pump.flush();

    expect(fixture.publishPcmTrack).not.toHaveBeenCalled();
    expect(fixture.queue.discardQueuedFrames(binding.callGeneration)).toBe(10);
  });
});

function setup() {
  const queue = new BoundedDeviceAudioQueue(20);
  const publishPcmTrack = vi.fn(async (
    _name: string,
    _samples: Int16Array,
    _sampleRate: 8_000 | 16_000,
  ) => undefined);
  const room: AirDeviceRoomClient = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    publishPcmTrack,
    setSubscribed: vi.fn(async () => undefined),
  };
  return {
    queue,
    publishPcmTrack,
    pump: new AirGatewayAudioPump({
      queue,
      currentBinding: () => binding,
      currentRoom: () => room,
    }),
  };
}

function pcmChunk() {
  const output = new Uint8Array(6_400);
  const view = new DataView(output.buffer);
  for (let index = 0; index < 3_200; index += 1) {
    view.setInt16(index * 2, index - 1_600, true);
  }
  return output;
}

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};
