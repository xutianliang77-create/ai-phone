import { describe, expect, it, vi } from "vitest";
import { AirDeviceBootAdmission } from "./air-device-boot-admission.js";
import { FixtureSerialTransport } from "./serial-transport-fixture.js";
import { VuartSerialFrameTransport } from "./vuart-serial-frame-transport.js";
import { AirDeviceGatewayCommandIngress } from "./vuart-v1-command-ingress.js";
import {
  encodeVuartV1HeartbeatPayload,
  encodeVuartV1HelloPayload,
  type VuartV1DeviceCommand,
} from "./vuart-v1-command-payload.js";
import { VuartV1CommandReplayGuard } from "./vuart-v1-command-replay-guard.js";
import { VuartV1SerialCommandExchange } from "./vuart-v1-serial-command-exchange.js";
import { decodeVuartFrame, encodeVuartFrame, VuartFrameType } from "./vuart-frame.js";

const binding = {
  communicationSessionId: "comm-1", providerCallId: "air-call-1",
  deviceId: "air-780-1", leaseId: "lease-1", fencingToken: 7,
  callGeneration: 3,
};

describe("Air device command channel pure-software closure", () => {
  it("cancels an ambiguous DIAL on a new boot and quarantines its late ACK", async () => {
    const fixture = new FixtureSerialTransport("fixture://full-command-channel");
    const frames = new VuartSerialFrameTransport(fixture);
    const admission = new AirDeviceBootAdmission({
      expectedDeviceId: binding.deviceId,
      frameSource: frames,
    });
    const exchange = new VuartV1SerialCommandExchange(frames, {
      responseTimeoutMs: 60_000,
    });
    const ingress = new AirDeviceGatewayCommandIngress(exchange, {
      admission,
      maxAttempts: 2,
      initialSequence: 100,
    });
    const apply = vi.fn().mockResolvedValue({ status: "applied" as const });
    const guard = new VuartV1CommandReplayGuard(apply);
    guard.bind(binding);
    await frames.open();

    fixture.receive(join(
      wire(VuartFrameType.HELLO, helloPayload("boot-1"), 1),
      wire(VuartFrameType.HEARTBEAT, heartbeatPayload("boot-1", 1), 2),
    ));
    admission.completeReconcile({ bootId: "boot-1", authorizedBinding: binding });

    const pending = ingress.execute(dial());
    await vi.waitFor(() => expect(fixture.writes()).toHaveLength(1));
    const request = decodeVuartFrame(fixture.writes()[0]!);
    const reply = (await guard.handle(request))!;
    expect(apply).toHaveBeenCalledTimes(1);

    fixture.receive(wire(VuartFrameType.HELLO, helloPayload("boot-2"), 3));
    expect(await pending).toEqual({ status: "blocked",
      reason: "boot_not_admitted", attempts: 1 });
    expect(fixture.writes()).toHaveLength(1);

    fixture.receive(wire(reply.type, reply.payload, 4));
    expect(exchange.metrics()).toMatchObject({ admissionCancels: 1,
      lateResponses: 1, quarantinedResponses: 1, pendingCommands: 0 });
    expect(admission.snapshot()).toMatchObject({ state: "quarantined",
      bootId: "boot-2" });
  });
});

function dial(): VuartV1DeviceCommand {
  return { ...binding, providerOperationId: "operation-1", commandId: "command-1",
    idempotencyKey: "idempotency-command-1", type: "dial",
    dialTargetE164: "+8613800138000" };
}

function helloPayload(bootId: string) {
  return encodeVuartV1HelloPayload({ deviceId: binding.deviceId, bootId,
    firmwareVersion: "000.999.007", protocolVersion: 1, capabilityFlags: 3,
    maxPayloadBytes: 6_461 });
}

function heartbeatPayload(bootId: string, heartbeatSequence: number) {
  return encodeVuartV1HeartbeatPayload({ deviceId: binding.deviceId, bootId,
    heartbeatSequence, uptimeMs: BigInt(heartbeatSequence), deviceState: "ready" });
}

function wire(type: number, payload: Uint8Array, sequence: number) {
  return encodeVuartFrame({ type, flags: 0, sequence,
    timestampMs: BigInt(sequence), payload });
}

function join(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}
