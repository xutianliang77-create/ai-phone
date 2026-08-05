import { describe, expect, it, vi } from "vitest";
import {
  AirDeviceBootAdmission,
} from "./air-device-boot-admission.js";
import { AirDeviceGatewayCommandIngress } from "./vuart-v1-command-ingress.js";
import { encodeVuartV1HeartbeatPayload,
  encodeVuartV1HelloPayload, type VuartV1DeviceCommand,
} from "./vuart-v1-command-payload.js";
import { VuartV1CommandReplayGuard } from "./vuart-v1-command-replay-guard.js";
import { FixtureVuartV1CommandTransport } from "./vuart-v1-command-transport-fixture.js";
import { VuartFrameType, type VuartFrame } from "./vuart-frame.js";

const binding = {
  communicationSessionId: "comm-1", providerCallId: "air-call-1",
  deviceId: "air-780-1", leaseId: "lease-1", fencingToken: 7,
  callGeneration: 3,
};

describe("Air device HELLO/HEARTBEAT boot admission", () => {
  it("blocks DIAL until the current boot is explicitly reconciled", async () => {
    const reconcile = vi.fn();
    const admission = new AirDeviceBootAdmission({
      expectedDeviceId: binding.deviceId,
      onReconcileRequired: reconcile,
    });
    const apply = vi.fn().mockResolvedValue({ status: "applied" as const });
    const guard = new VuartV1CommandReplayGuard(apply);
    guard.bind(binding);
    const transport = new FixtureVuartV1CommandTransport(guard);
    const ingress = new AirDeviceGatewayCommandIngress(transport, { admission });

    admission.observe(hello("boot-1"));
    admission.observe(heartbeat("boot-1", 1, "ready"));
    expect(await ingress.execute(dial())).toEqual({ status: "blocked",
      reason: "boot_not_admitted", attempts: 0 });
    expect(transport.requests()).toHaveLength(0);

    admission.completeReconcile({ bootId: "boot-1", authorizedBinding: binding });
    expect(await ingress.execute(dial())).toMatchObject({ status: "ack" });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalled();
  });

  it("quarantines a new boot and ignores heartbeat from the old boot", async () => {
    const admission = new AirDeviceBootAdmission({ expectedDeviceId: binding.deviceId });
    admission.observe(hello("boot-1"));
    admission.observe(heartbeat("boot-1", 1, "ready"));
    admission.completeReconcile({ bootId: "boot-1", authorizedBinding: binding });
    admission.observe(hello("boot-2"));
    admission.observe(heartbeat("boot-1", 2, "in_call", binding));

    expect(admission.snapshot()).toMatchObject({ state: "quarantined",
      bootId: "boot-2", staleBootFrames: 1 });
    expect(admission.commandBlockReason(dial())).toBe("boot_not_admitted");
  });

  it("rejects old lease, fence, and generation after boot reconciliation", () => {
    const admission = new AirDeviceBootAdmission({ expectedDeviceId: binding.deviceId });
    const current = { ...binding, leaseId: "lease-2", fencingToken: 8,
      callGeneration: 4 };
    admission.observe(hello("boot-2"));
    admission.observe(heartbeat("boot-2", 1, "in_call", current));
    admission.completeReconcile({ bootId: "boot-2", authorizedBinding: current });

    for (const stale of [
      dial({ leaseId: binding.leaseId, fencingToken: 8, callGeneration: 4 }),
      dial({ leaseId: "lease-2", fencingToken: 7, callGeneration: 4 }),
      dial({ leaseId: "lease-2", fencingToken: 8, callGeneration: 3 }),
    ]) {
      expect(admission.commandBlockReason(stale)).toBe("binding_mismatch");
    }
  });

  it("does not admit an in-call heartbeat against a different authoritative binding", () => {
    const admission = new AirDeviceBootAdmission({ expectedDeviceId: binding.deviceId });
    admission.observe(hello("boot-1"));
    admission.observe(heartbeat("boot-1", 1, "in_call", binding));
    expect(() => admission.completeReconcile({
      bootId: "boot-1",
      authorizedBinding: { ...binding, callGeneration: 4 },
    })).toThrow("binding");
    expect(admission.snapshot().state).toBe("reconciling");
  });

  it("requires boot reconciliation after a Gateway restart before replaying a lost ACK", async () => {
    const apply = vi.fn().mockResolvedValue({ status: "applied" as const });
    const guard = new VuartV1CommandReplayGuard(apply);
    guard.bind(binding);
    const transport = new FixtureVuartV1CommandTransport(guard);
    const admitted = admittedBoot("boot-1");
    const firstIngress = new AirDeviceGatewayCommandIngress(transport, {
      admission: admitted,
      maxAttempts: 1,
      initialSequence: 100,
      nowMs: () => 1_000n,
    });
    transport.dropNextResponses(1);

    expect(await firstIngress.execute(dial())).toMatchObject({
      status: "timeout_reconcile_required",
    });
    expect(apply).toHaveBeenCalledTimes(1);

    const restartedAdmission = new AirDeviceBootAdmission({
      expectedDeviceId: binding.deviceId,
    });
    const restartedIngress = new AirDeviceGatewayCommandIngress(transport, {
      admission: restartedAdmission,
      maxAttempts: 1,
      initialSequence: 100,
      nowMs: () => 1_000n,
    });
    expect(await restartedIngress.execute(dial())).toEqual({ status: "blocked",
      reason: "boot_not_admitted", attempts: 0 });
    expect(transport.requests()).toHaveLength(1);

    restartedAdmission.observe(hello("boot-1"));
    restartedAdmission.observe(heartbeat("boot-1", 2, "ready"));
    restartedAdmission.completeReconcile({ bootId: "boot-1",
      authorizedBinding: binding });
    expect(await restartedIngress.execute(dial())).toMatchObject({ status: "ack",
      attempts: 1 });
    expect(transport.requests()[1]).toEqual(transport.requests()[0]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(guard.metrics()).toMatchObject({ commandsApplied: 1, ackReplays: 1 });
  });

  it("revokes admission on disconnect and requires a fresh heartbeat plus reconcile", () => {
    const admission = admittedBoot("boot-1");
    admission.disconnect("usb_reset");
    expect(admission.snapshot()).toMatchObject({ state: "quarantined",
      disconnects: 1 });
    expect(admission.commandBlockReason(dial())).toBe("boot_not_admitted");

    admission.observe(hello("boot-1"));
    admission.observe(heartbeat("boot-1", 2, "ready"));
    expect(admission.snapshot().state).toBe("reconciling");
    admission.completeReconcile({ bootId: "boot-1", authorizedBinding: binding });
    expect(admission.commandBlockReason(dial())).toBeNull();
  });

  it("blocks DTMF when the current boot did not declare that capability", () => {
    const admission = admittedBoot("boot-1");
    expect(admission.commandBlockReason({ ...dial(), type: "dtmf", digits: "1#" }))
      .toBe("capability_missing");
  });

  it("does not roll back to a retired boot when an old HELLO arrives late", () => {
    const admission = new AirDeviceBootAdmission({ expectedDeviceId: binding.deviceId });
    admission.observe(hello("boot-1"));
    admission.observe(heartbeat("boot-1", 1, "ready"));
    admission.observe(hello("boot-2"));
    admission.observe(hello("boot-1"));

    expect(admission.snapshot()).toMatchObject({ bootId: "boot-2",
      state: "quarantined", staleBootFrames: 1 });
  });

  it("ignores heartbeat sequence or uptime rollback", () => {
    const admission = admittedBoot("boot-1");
    admission.observe(frame(VuartFrameType.HEARTBEAT,
      encodeVuartV1HeartbeatPayload({ deviceId: binding.deviceId, bootId: "boot-1",
        heartbeatSequence: 2, uptimeMs: 0n, deviceState: "ready" })));
    admission.observe(heartbeat("boot-1", 1, "ready"));

    expect(admission.snapshot()).toMatchObject({ state: "admitted",
      staleHeartbeats: 2, heartbeat: { heartbeatSequence: 1, uptimeMs: 1n } });
  });

  it("rejects malformed authoritative bindings and call-only commands while ready", () => {
    const admission = new AirDeviceBootAdmission({ expectedDeviceId: binding.deviceId });
    admission.observe(hello("boot-1", 0x0b));
    admission.observe(heartbeat("boot-1", 1, "ready"));
    expect(() => admission.completeReconcile({ bootId: "boot-1",
      authorizedBinding: { ...binding, leaseId: "" } })).toThrow("binding");
    admission.completeReconcile({ bootId: "boot-1", authorizedBinding: binding });

    expect(admission.commandBlockReason({ ...dial(), type: "hangup" }))
      .toBe("device_not_ready");
    expect(admission.commandBlockReason({ ...dial(), type: "dtmf", digits: "1#" }))
      .toBe("device_not_ready");
  });

  it("blocks commands after the admitted heartbeat becomes stale", () => {
    let nowMs = 1_000;
    const admission = new AirDeviceBootAdmission({ expectedDeviceId: binding.deviceId,
      heartbeatTimeoutMs: 100, nowMs: () => nowMs });
    admission.observe(hello("boot-1"));
    admission.observe(heartbeat("boot-1", 1, "ready"));
    admission.completeReconcile({ bootId: "boot-1", authorizedBinding: binding });
    nowMs = 1_101;

    expect(admission.commandBlockReason(dial())).toBe("device_not_ready");
    expect(admission.snapshot()).toMatchObject({ heartbeatAgeMs: 101 });
  });
});

function admittedBoot(bootId: string) {
  const admission = new AirDeviceBootAdmission({ expectedDeviceId: binding.deviceId });
  admission.observe(hello(bootId));
  admission.observe(heartbeat(bootId, 1, "ready"));
  admission.completeReconcile({ bootId, authorizedBinding: binding });
  return admission;
}

function dial(overrides = {}): VuartV1DeviceCommand {
  return { ...binding, providerOperationId: "operation-1", commandId: "command-1",
    idempotencyKey: "idempotency-command-1", type: "dial",
    dialTargetE164: "+8613800138000", ...overrides } as VuartV1DeviceCommand;
}

function hello(bootId: string, capabilityFlags = 3): VuartFrame {
  return frame(VuartFrameType.HELLO, encodeVuartV1HelloPayload({
    deviceId: binding.deviceId, bootId, firmwareVersion: "000.999.007",
    protocolVersion: 1, capabilityFlags, maxPayloadBytes: 6_461,
  }));
}

function heartbeat(
  bootId: string,
  heartbeatSequence: number,
  deviceState: "ready" | "in_call",
  activeBinding?: typeof binding,
): VuartFrame {
  return frame(VuartFrameType.HEARTBEAT, encodeVuartV1HeartbeatPayload({
    deviceId: binding.deviceId, bootId, heartbeatSequence,
    uptimeMs: BigInt(heartbeatSequence), deviceState,
    ...(activeBinding ? { activeBinding } : {}),
  }));
}

function frame(type: number, payload: Uint8Array): VuartFrame {
  return { version: 1, type, flags: 0, sequence: 1, timestampMs: 1n, payload };
}
