import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureSerialTransport } from
  "../device/serial-transport-fixture.js";
import {
  decodeVuartFrame,
  encodeVuartFrame,
  VuartFrameType,
} from "../device/vuart-frame.js";
import {
  decodeVuartV1CommandPayload,
  encodeVuartV1AckPayload,
} from "../device/vuart-v1-command-payload.js";
import { AirDeviceGatewayRuntime } from "./air-device-gateway-runtime.js";
import {
  audioFrame,
  binding,
  callStateFrame,
  config,
  dial,
  eventOutboxes,
  heartbeatFrame,
  helloFrame,
  recoveryAccess,
  request,
  roomClient,
} from "./air-device-gateway-runtime.test-support.js";

describe("Air device Gateway recovery", () => {
  let runtime: AirDeviceGatewayRuntime | undefined;

  afterEach(async () => runtime?.stop());

  it("recovers fail-closed when VUART appears after startup", async () => {
    const serial = new FixtureSerialTransport(config.hardware.serialPath, {
      openFailures: 2,
    });
    runtime = new AirDeviceGatewayRuntime({
      config,
      serial,
      createRoom: roomClient,
      carrierClient: {
        publish: async () => undefined,
        publishLiveKit: async () => undefined,
        publishHeartbeat: async () => undefined,
        recoverMedia: async () => recoveryAccess(),
        admitTrack: async () => { throw new Error("not requested"); },
      },
      commandLedger: commandLedger(),
      eventOutboxes: eventOutboxes(),
      serialRecoveryRetryDelayMs: 1,
    });

    await runtime.start();
    const baseUrl = `http://127.0.0.1:${runtime.address()!.port}`;
    const unavailable = await fetch(`${baseUrl}/readyz`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      ready: false,
      hello: "missing",
      heartbeat: "missing",
      bootAdmission: "quarantined",
      serialRecovery: { disconnects: 0, startupOpenFailures: 1 },
    });

    await vi.waitFor(() => expect(serial.isOpen).toBe(true));
    expect(serial.openAttempts).toBe(3);
    expect(serial.writes()).toHaveLength(0);
    expect(runtime.readiness()).toMatchObject({
      ready: false,
      tty: "open",
      dtr: "asserted",
      hello: "missing",
      heartbeat: "missing",
      bootAdmission: "quarantined",
      serialRecovery: {
        state: "idle",
        disconnects: 0,
        startupOpenFailures: 1,
        attempts: 2,
        failures: 1,
        recoveries: 1,
      },
    });
  });

  it("restores exact active media after USB recovery without DIAL", async () => {
    const serial = new FixtureSerialTransport(config.hardware.serialPath);
    const room = roomClient();
    const recoverMedia = vi.fn(async () => recoveryAccess());
    runtime = new AirDeviceGatewayRuntime({
      config,
      serial,
      createRoom: () => room,
      carrierClient: {
        publish: async () => undefined,
        publishLiveKit: async () => undefined,
        publishHeartbeat: async () => undefined,
        recoverMedia,
        admitTrack: async (admissionRequest) => {
          const { roomName: _room, fencingToken: _fence, ...admission } =
            admissionRequest;
          return { uplinkSource: "translated_tts" as const, ...admission };
        },
      },
      commandLedger: commandLedger(),
      eventOutboxes: eventOutboxes(),
      serialRecoveryRetryDelayMs: 1,
    });
    await runtime.start();
    serial.receive(helloFrame());
    serial.receive(heartbeatFrame());
    const baseUrl = `http://127.0.0.1:${runtime.address()!.port}`;
    const dialing = fetch(`${baseUrl}/v1/device-commands`, request(dial));
    await vi.waitFor(() => expect(serial.writes()).toHaveLength(1));
    acknowledgeDial(serial, 41);
    expect((await dialing).status).toBe(202);
    serial.receive(callStateFrame());

    serial.disconnect("usb_reset");
    await vi.waitFor(() => expect(serial.isOpen).toBe(true));
    serial.receive(helloFrame());
    serial.receive(heartbeatFrame({
      heartbeatSequence: 2,
      deviceState: "in_call",
    }));

    await vi.waitFor(() => expect(recoverMedia).toHaveBeenCalledWith(binding));
    await vi.waitFor(() => expect(room.connect).toHaveBeenCalledTimes(2));
    expect(serial.writes()).toHaveLength(1);
    expect(runtime.readiness()).toMatchObject({
      bootAdmission: "admitted",
      room: "connected",
      mediaRecovery: { attempts: 1, recoveries: 1, failures: 0 },
      media: { router: { authoritativeRestores: 1 } },
    });

    serial.receive(audioFrame({ frameSequence: 8, mediaSequence: 2 }));
    await vi.waitFor(() => expect(room.publishPcmTrack).toHaveBeenCalledTimes(10));
  });
});

function commandLedger() {
  return {
    load: async () => [],
    upsert: async () => undefined,
    remove: async () => undefined,
  };
}

function acknowledgeDial(serial: FixtureSerialTransport, sequence: number) {
  const frame = decodeVuartFrame(serial.writes()[0]!);
  const command = decodeVuartV1CommandPayload(frame.type, frame.payload);
  serial.receive(encodeVuartFrame({
    type: VuartFrameType.ACK,
    flags: 0,
    sequence,
    timestampMs: BigInt(sequence),
    payload: encodeVuartV1AckPayload({
      ...command,
      requestFrameSequence: frame.sequence,
      commandType: command.type,
      result: "applied",
    }),
  }));
}
