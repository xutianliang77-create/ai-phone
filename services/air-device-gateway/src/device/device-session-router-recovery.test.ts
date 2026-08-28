import { describe, expect, it } from "vitest";
import { BoundedDeviceAudioQueue } from "../media/device-audio-queue.js";
import {
  AirDeviceSessionRouter,
  type AirDeviceSessionBinding,
} from "./device-session-router.js";

const binding = (overrides: Partial<AirDeviceSessionBinding> = {}) => ({
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  ...overrides,
});

const decoder = {
  decodeAudio: () => null,
  decodeCallState: () => null,
};

describe("Air device session router recovery", () => {
  it("restores only the exact retired generation", () => {
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(20),
      decoder,
    });
    router.bind(binding());
    router.disconnect("usb_reset");

    expect(router.restoreAuthoritative(binding())).toBe(true);
    expect(router.binding()).toEqual(binding());
    expect(router.restoreAuthoritative(binding())).toBe(false);
    router.disconnect("second_reset");
    expect(() => router.restoreAuthoritative(binding({ leaseId: "stale" })))
      .toThrow("must match the retired binding");
    expect(() => router.restoreAuthoritative(binding({ callGeneration: 2 })))
      .toThrow("must match the retired binding");
    expect(router.metrics()).toMatchObject({ authoritativeRestores: 1 });
  });

  it("accepts an API-authoritative generation after process restart", () => {
    const router = new AirDeviceSessionRouter({
      queue: new BoundedDeviceAudioQueue(20),
      decoder,
    });

    expect(router.restoreAuthoritative(binding())).toBe(true);
    expect(router.binding()).toEqual(binding());
    expect(() => router.bind(binding())).toThrow("callGeneration must increase");
  });
});
