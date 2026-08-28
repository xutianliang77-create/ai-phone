import { afterEach, describe, expect, it, vi } from "vitest";
import type { AirDeviceTrackAdmissionRequest } from "@translation/contracts";
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
import { decodeVuartV1AudioPayload } from "../device/vuart-v1-payload.js";
import { AirDeviceGatewayRuntime } from "./air-device-gateway-runtime.js";
import {
  audioFrame,
  binding,
  callStateFrame,
  config,
  devicePcm,
  dial,
  eventOutboxes,
  heartbeatFrame,
  helloFrame,
  reconcile,
  recoveryAccess,
  request,
  roomClient,
  samplesToBytes,
} from "./air-device-gateway-runtime.test-support.js";

describe("Air device Gateway runtime", () => {
  let runtime: AirDeviceGatewayRuntime | undefined;

  afterEach(async () => runtime?.stop());

  it("closes App HTTP to admitted VUART and carrier-only reconciliation", async () => {
    const serial = new FixtureSerialTransport(config.hardware.serialPath);
    const room = roomClient();
    const publish = vi.fn(async () => undefined);
    const publishLiveKit = vi.fn(async () => undefined);
    const publishHeartbeat = vi.fn(async () => undefined);
    const recoverMedia = vi.fn(async () => recoveryAccess());
    const admitTrack = vi.fn(async (request: AirDeviceTrackAdmissionRequest) => {
      const { roomName: _room, fencingToken: _fence, ...admission } = request;
      return { uplinkSource: "translated_tts" as const, ...admission };
    });
    runtime = new AirDeviceGatewayRuntime({
      config,
      serial,
      createRoom: () => room,
      carrierClient: {
        publish,
        publishLiveKit,
        publishHeartbeat,
        recoverMedia,
        admitTrack,
      },
      commandLedger: {
        load: async () => [],
        upsert: async () => undefined,
        remove: async () => undefined,
      },
      eventOutboxes: eventOutboxes(),
      now: () => new Date("2026-08-04T12:00:00.000Z"),
    });
    await runtime.start();
    const baseUrl = `http://127.0.0.1:${runtime.address()!.port}`;

    serial.receive(helloFrame());
    serial.receive(heartbeatFrame());
    await vi.waitFor(() => expect(publishHeartbeat).toHaveBeenCalledOnce());
    expect(publishHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: binding.deviceId,
      bootId: "boot-1",
      deviceState: "ready",
    }));
    expect(publishHeartbeat.mock.calls[0]?.[0])
      .not.toHaveProperty("activeBinding");
    const readiness = await fetch(`${baseUrl}/readyz`);
    expect(readiness.status).toBe(200);
    const readinessBody = await readiness.json();
    expect(readinessBody).toMatchObject({
      ready: true,
      tty: "open",
      dtr: "asserted",
      hello: "observed",
      heartbeat: "observed",
      bootAdmission: "reconciling",
      room: "absent",
      protocol: {
        stream: { framesDecoded: 2, invalidFrames: 0 },
        admission: { invalidFrames: 0, invalidFrameReasons: {} },
      },
    });
    const readinessJson = JSON.stringify(readinessBody);
    expect(readinessJson).not.toContain(binding.deviceId);
    expect(readinessJson).not.toContain(binding.providerCallId);
    expect(readinessJson).not.toContain("boot-1");
    expect(readinessJson).not.toMatch(/callerNumber|rawEvent|firmwareVersion/);

    const dialResponse = fetch(`${baseUrl}/v1/device-commands`, request(dial));
    await vi.waitFor(() => expect(serial.writes()).toHaveLength(1));
    const commandFrame = decodeVuartFrame(serial.writes()[0]!);
    const command = decodeVuartV1CommandPayload(
      commandFrame.type,
      commandFrame.payload,
    );
    serial.receive(encodeVuartFrame({
      type: VuartFrameType.ACK,
      flags: 0,
      sequence: 30,
      timestampMs: 30n,
      payload: encodeVuartV1AckPayload({
        ...command,
        requestFrameSequence: commandFrame.sequence,
        commandType: command.type,
        result: "applied",
      }),
    }));
    const accepted = await dialResponse;
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({
      status: "ack",
      providerCallId: binding.providerCallId,
    });
    expect(room.connect).toHaveBeenCalledWith(
      "wss://livekit.example.cn/",
      "room-token",
      {
        autoSubscribe: false,
        communicationSessionId: "comm-1",
        mediaPolicy: "translation_isolated",
      },
    );
    await vi.waitFor(() => expect(publishLiveKit).toHaveBeenCalledTimes(2));
    expect(publishLiveKit.mock.calls.map(([event]) =>
      event.liveKitParticipantState)).toEqual(["joining", "joined"]);

    serial.receive(audioFrame());
    expect(room.publishPcmTrack).not.toHaveBeenCalled();
    expect(runtime.readiness().media).toMatchObject({
      nonConnectedDownlinkDrops: 1,
    });

    serial.receive(callStateFrame());
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    serial.receive(audioFrame({ frameSequence: 5, mediaSequence: 2 }));
    await vi.waitFor(() => expect(room.publishPcmTrack).toHaveBeenCalledTimes(10));
    expect(room.publishPcmTrack.mock.calls.every(([name, samples, sampleRate]) =>
      name === `air780-downlink-${binding.deviceId}` &&
      samples.length === 320 && sampleRate === 16_000)).toBe(true);
    expect(samplesToBytes(room.publishPcmTrack.mock.calls.flatMap(([, samples]) =>
      [...samples]))).toEqual(devicePcm);

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      communicationSessionId: binding.communicationSessionId,
      carrierState: "connected",
      eventSequence: 1,
    }));
    const reconcileResponse = await fetch(
      `${baseUrl}/v1/device-commands`,
      request(reconcile),
    );
    expect(reconcileResponse.status).toBe(200);
    expect(await reconcileResponse.json()).toMatchObject({
      status: "observed",
      state: "connected",
    });
    expect(serial.writes()).toHaveLength(1);

    const target = "comm-1:guest:air:air-780-1";
    room.emitRemoteTrack({
      sid: "TR_tts_1",
      name: `translation-tts-guest-1.${Buffer.from(target).toString("base64url")}`,
      publisherIdentity: "comm-1:worker:voice-agent-1",
    });
    await vi.waitFor(() => expect(room.setSubscribed)
      .toHaveBeenCalledWith("TR_tts_1", true));
    const expectedTts: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const samples = Int16Array.from({ length: 320 }, (_, offset) =>
        index * 320 + offset - 1_600);
      expectedTts.push(...samples);
      room.emitAudioFrame({ trackSid: "TR_tts_1", samples,
        sampleRate: 16_000 });
    }
    await vi.waitFor(() => expect(serial.writes()).toHaveLength(2));
    const ttsFrame = decodeVuartFrame(serial.writes()[1]!);
    const tts = decodeVuartV1AudioPayload(ttsFrame.payload);
    expect(ttsFrame).toMatchObject({
      type: VuartFrameType.AUDIO_UPLINK,
      sequence: commandFrame.sequence + 1,
    });
    expect(tts).toMatchObject({ ...binding, mediaSequence: 0 });
    expect(tts.payload).toEqual(samplesToBytes(expectedTts));
    expect(runtime.readiness().media.ttsUplink).toMatchObject({
      acceptedFrames: 10,
      writtenChunks: 1,
      droppedChunks: 0,
    });

    serial.receive(callStateFrame({
      frameSequence: 6,
      eventSequence: 2,
      carrierState: "unknown",
    }));
    await vi.waitFor(() => expect(room.disconnect).toHaveBeenCalledOnce());
    expect(runtime.readiness().media).toMatchObject({
      ttsUplink: { ready: false },
      router: { terminalClears: 0 },
    });
    room.emitAudioFrame({
      trackSid: "TR_tts_1",
      samples: new Int16Array(320),
      sampleRate: 16_000,
    });
    expect(serial.writes()).toHaveLength(2);
  });

  it("fails startup before opening serial when the command ledger cannot load", async () => {
    const serial = new FixtureSerialTransport(config.hardware.serialPath);
    const unavailable = vi.fn().mockRejectedValue(new Error("ledger corrupt"));
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
      commandLedger: {
        load: unavailable,
        upsert: async () => undefined,
        remove: async () => undefined,
      },
      eventOutboxes: eventOutboxes(),
    });

    await expect(runtime.start()).rejects.toThrow("ledger corrupt");
    expect(serial.isOpen).toBe(false);
    expect(runtime.address()).toBeNull();
  });

  it("reopens USB serial in quarantine without replaying the old generation", async () => {
    const serial = new FixtureSerialTransport(config.hardware.serialPath);
    const room = roomClient();
    runtime = new AirDeviceGatewayRuntime({
      config,
      serial,
      createRoom: () => room,
      carrierClient: {
        publish: async () => undefined,
        publishLiveKit: async () => undefined,
        publishHeartbeat: async () => undefined,
        recoverMedia: async () => recoveryAccess(),
        admitTrack: async (request) => {
          const { roomName: _room, fencingToken: _fence, ...admission } = request;
          return { uplinkSource: "translated_tts" as const, ...admission };
        },
      },
      commandLedger: {
        load: async () => [],
        upsert: async () => undefined,
        remove: async () => undefined,
      },
      eventOutboxes: eventOutboxes(),
    });
    await runtime.start();
    serial.receive(helloFrame());
    serial.receive(heartbeatFrame());
    const baseUrl = `http://127.0.0.1:${runtime.address()!.port}`;
    const dialing = fetch(`${baseUrl}/v1/device-commands`, request(dial));
    await vi.waitFor(() => expect(serial.writes()).toHaveLength(1));
    const frame = decodeVuartFrame(serial.writes()[0]!);
    const command = decodeVuartV1CommandPayload(frame.type, frame.payload);
    serial.receive(encodeVuartFrame({
      type: VuartFrameType.ACK,
      flags: 0,
      sequence: 40,
      timestampMs: 40n,
      payload: encodeVuartV1AckPayload({
        ...command,
        requestFrameSequence: frame.sequence,
        commandType: command.type,
        result: "applied",
      }),
    }));
    expect((await dialing).status).toBe(202);

    serial.disconnect("usb_reset");
    await vi.waitFor(() => expect(serial.isOpen).toBe(true));
    await vi.waitFor(() => expect(room.disconnect).toHaveBeenCalledOnce());
    serial.receive(audioFrame());
    serial.receive(helloFrame());
    serial.receive(heartbeatFrame());

    expect(room.publishPcmTrack).not.toHaveBeenCalled();
    expect(serial.writes()).toHaveLength(1);
    expect(runtime.readiness()).toMatchObject({
      ready: true,
      tty: "open",
      bootAdmission: "reconciling",
      room: "absent",
      serialRecovery: { disconnects: 1, recoveries: 1 },
      media: { router: { unboundFrames: 1, disconnects: 1 } },
    });
  });

});
