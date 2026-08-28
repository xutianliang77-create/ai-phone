import { describe, expect, it, vi } from "vitest";
import { AirGatewayMediaRecovery } from "./air-gateway-media-recovery.js";

describe("Air Gateway media recovery", () => {
  it("restores binding, carrier, and room without a device command", async () => {
    const fixture = setup();
    fixture.recovery.observe(snapshot());
    await fixture.recovery.flush();
    await vi.waitFor(() => expect(fixture.prepareRoom).toHaveBeenCalledOnce());

    expect(fixture.requestAccess).toHaveBeenCalledWith(binding);
    expect(fixture.restoreDevice).toHaveBeenCalledWith(binding);
    expect(fixture.restoreCarrier).toHaveBeenCalledWith(binding, "connected");
    expect(fixture.prepareRoom).toHaveBeenCalledWith(expect.objectContaining({
      ...binding,
      roomName: "call_comm-1",
      participantIdentity: "comm-1:guest:air:air-780-1",
    }));
    expect(fixture.recovery.metrics()).toMatchObject({
      attempts: 1,
      recoveries: 1,
      failures: 0,
    });
  });

  it("rejects a stale API response before restoring local state", async () => {
    const fixture = setup({ response: { ...access(), callGeneration: 4 } });
    fixture.recovery.observe(snapshot());
    await vi.waitFor(() => expect(fixture.requestAccess).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.recovery.metrics().recovering).toBe(false));

    expect(fixture.restoreDevice).not.toHaveBeenCalled();
    expect(fixture.prepareRoom).not.toHaveBeenCalled();
    expect(fixture.recovery.metrics()).toMatchObject({ staleResponses: 1 });
  });

  it("rolls back the restored binding when room recovery fails", async () => {
    const fixture = setup({ roomFailure: true });
    fixture.recovery.observe(snapshot());
    await vi.waitFor(() => expect(fixture.rollbackDevice).toHaveBeenCalledWith(binding));

    expect(fixture.recovery.metrics()).toMatchObject({
      recoveries: 0,
      failures: 1,
      rollbacks: 1,
    });
  });
});

function setup(options: { response?: ReturnType<typeof access>;
  roomFailure?: boolean } = {}) {
  const requestAccess = vi.fn(async () => options.response ?? access());
  const restoreDevice = vi.fn(async () => true);
  const restoreCarrier = vi.fn();
  const prepareRoom = options.roomFailure
    ? vi.fn(async () => { throw new Error("room unavailable"); })
    : vi.fn(async () => true);
  const rollbackDevice = vi.fn(async () => undefined);
  const recovery = new AirGatewayMediaRecovery({
    requestAccess,
    isRecovered: () => false,
    isStillAuthoritative: () => true,
    restoreDevice,
    restoreCarrier,
    prepareRoom,
    rollbackDevice,
  });
  return { recovery, requestAccess, restoreDevice, restoreCarrier, prepareRoom,
    rollbackDevice };
}

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};

function access() {
  return {
    ...binding,
    roomName: "call_comm-1",
    participantIdentity: "comm-1:guest:air:air-780-1",
    carrierState: "connected" as const,
    roomAccess: {
      wsUrl: "wss://livekit.example.cn",
      token: "fresh-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      mediaPolicy: "translation_isolated" as const,
    },
  };
}

function snapshot() {
  return {
    state: "reconciling" as const,
    bootId: "boot-1",
    hello: {
      deviceId: binding.deviceId,
      bootId: "boot-1",
      firmwareVersion: "production-r2",
      protocolVersion: 1,
      capabilityFlags: 7,
      maxPayloadBytes: 8_192,
    },
    heartbeat: {
      deviceId: binding.deviceId,
      bootId: "boot-1",
      heartbeatSequence: 2,
      uptimeMs: 2_000n,
      deviceState: "in_call" as const,
      activeBinding: binding,
    },
    heartbeatAgeMs: 0,
    bootChanges: 0,
    staleBootFrames: 0,
    staleHeartbeats: 0,
    invalidFrames: 0,
    invalidFrameReasons: {},
    reconcileCompletions: 0,
    disconnects: 1,
  };
}
