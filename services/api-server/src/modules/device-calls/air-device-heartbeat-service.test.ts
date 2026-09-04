import { describe, expect, it, vi } from "vitest";
import { DeviceLeaseConflict } from "./device-lease-registry.js";
import { AirDeviceHeartbeatService } from
  "./air-device-heartbeat-service.js";

describe("Air device heartbeat service", () => {
  it("atomically records a heartbeat and renews its exact call fence", async () => {
    const fixture = setup({ result: { registration, leaseRenewed: true } });

    await expect(fixture.service.process(heartbeat)).resolves.toEqual({
      registration,
      leaseRenewed: true,
    });
    expect(fixture.claim).toHaveBeenCalledWith(expect.objectContaining({
      eventId: heartbeat.eventId,
      sessionId: heartbeat.deviceId,
      eventType: "device.heartbeat",
      payload: heartbeat,
    }));
    expect(fixture.processHeartbeat).toHaveBeenCalledWith(
      fixture.client,
      { ...heartbeat, leaseTtlSeconds: 60 },
    );
  });

  it("returns a durable inbox replay without repeating a side effect", async () => {
    const result = { registration, leaseRenewed: true };
    const fixture = setup({ duplicate: true, result });

    await expect(fixture.service.process(heartbeat)).resolves.toEqual(result);

    expect(fixture.completeClaim).not.toHaveBeenCalled();
    expect(fixture.processHeartbeat).not.toHaveBeenCalled();
  });

  it("abandons a failed stale-fence claim without renewing it", async () => {
    const conflict = new DeviceLeaseConflict("stale fence");
    const fixture = setup({ failure: conflict });

    await expect(fixture.service.process(heartbeat)).rejects.toBe(conflict);

    expect(fixture.abandon).toHaveBeenCalledWith(
      heartbeat.eventId,
      "air-gateway-event:test",
    );
  });
});

function setup(input: {
  duplicate?: boolean;
  result?: { registration: typeof registration; leaseRenewed: boolean };
  failure?: Error;
}) {
  const client = { query: vi.fn() } as never;
  const processHeartbeat = input.failure
    ? vi.fn().mockRejectedValue(input.failure)
    : vi.fn(async () => input.result ?? { registration, leaseRenewed: false });
  const claim = vi.fn(async () => ({
    duplicate: input.duplicate ?? false,
    result: input.duplicate ? input.result : undefined,
  }));
  const completeClaim = vi.fn(async (request: {
    beforeComplete(client: never): Promise<void>;
  }) => request.beforeComplete(client));
  const abandon = vi.fn(async () => undefined);
  return {
    client,
    claim,
    completeClaim,
    abandon,
    processHeartbeat,
    service: new AirDeviceHeartbeatService({
      registry: { processHeartbeat },
      inbox: { claim, completeClaim, abandon },
      leaseTtlSeconds: 60,
      claimOwner: "air-gateway-event:test",
    }),
  };
}

const registration = {
  deviceId: "air-001",
  firmwareVersion: "production-r2",
  protocolVersion: "vuart-v1",
  supportedSampleRates: [16_000] as Array<16_000>,
  status: "reserved" as const,
  lastHeartbeatAt: "2026-08-04T12:00:00.000Z",
  fencingToken: 7,
  version: 8,
};

const heartbeat = {
  eventId: "air_hb_1",
  deviceId: "air-001",
  bootId: "boot-1",
  firmwareVersion: "production-r2",
  protocolVersion: "vuart-v1",
  supportedSampleRates: [16_000] as Array<16_000>,
  heartbeatSequence: 10,
  uptimeMs: "10000",
  deviceState: "in_call" as const,
  observedAt: "2026-08-04T12:00:00.000Z",
  activeBinding: {
    communicationSessionId: "call-1",
    providerCallId: "air-call-1",
    deviceId: "air-001",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 7,
  },
};
