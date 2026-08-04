import { describe, expect, it } from "vitest";
import { DeviceLeaseConflict, MemoryAirDeviceRegistry } from "./device-lease-registry.js";

describe("Air device registry and lease fencing", () => {
  it("claims a ready device and monotonically advances its fencing token", () => {
    const registry = new MemoryAirDeviceRegistry();
    registry.register({
      deviceId: "air-001",
      firmwareVersion: "13.0.0",
      sampleRates: [8_000, 16_000],
      nowMs: 1_000,
    });

    const first = registry.claim({
      communicationSessionId: "session-1",
      nowMs: 1_100,
      ttlMs: 30_000,
    });
    registry.release({
      leaseId: first.leaseId,
      fencingToken: first.fencingToken,
      nowMs: 1_200,
    });
    const second = registry.claim({
      communicationSessionId: "session-2",
      nowMs: 1_300,
      ttlMs: 30_000,
    });

    expect(second.deviceId).toBe("air-001");
    expect(second.fencingToken).toBe(first.fencingToken + 1);
    expect(() => registry.assertLease({
      deviceId: first.deviceId,
      leaseId: first.leaseId,
      fencingToken: first.fencingToken,
      nowMs: 1_400,
    })).toThrow(DeviceLeaseConflict);
  });

  it("replays the same session claim instead of allocating twice", () => {
    const registry = new MemoryAirDeviceRegistry();
    registry.register({
      deviceId: "air-001",
      firmwareVersion: "13.0.0",
      sampleRates: [8_000],
      nowMs: 1_000,
    });
    const first = registry.claim({
      communicationSessionId: "session-1",
      nowMs: 1_100,
      ttlMs: 30_000,
    });
    const replay = registry.claim({
      communicationSessionId: "session-1",
      nowMs: 1_200,
      ttlMs: 30_000,
    });
    expect(replay).toEqual(first);
  });

  it("quarantines an expired lease instead of assigning the device again", () => {
    const registry = new MemoryAirDeviceRegistry();
    registry.register({
      deviceId: "air-001",
      firmwareVersion: "13.0.0",
      sampleRates: [16_000],
      nowMs: 1_000,
    });
    registry.claim({
      communicationSessionId: "session-1",
      nowMs: 1_100,
      ttlMs: 100,
    });

    expect(() => registry.claim({
      communicationSessionId: "session-2",
      nowMs: 1_201,
      ttlMs: 100,
    })).toThrow("No ready Air device");
  });
});
