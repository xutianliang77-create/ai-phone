import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeVuartV1AckPayload,
  decodeVuartV1CommandPayload,
  decodeVuartV1ErrorPayload,
  decodeVuartV1HeartbeatPayload,
  decodeVuartV1HelloPayload,
  encodeVuartV1AckPayload,
  encodeVuartV1CommandPayload,
  encodeVuartV1ErrorPayload,
  encodeVuartV1HeartbeatPayload,
  encodeVuartV1HelloPayload,
  type VuartV1CommandContext,
} from "./vuart-v1-command-payload.js";
import { encodeVuartFrame, VuartFrameType } from "./vuart-frame.js";

const golden = JSON.parse(readFileSync(new URL(
  "../../fixtures/vuart-v1/command-golden-vectors.json",
  import.meta.url,
), "utf8")) as CommandGoldenVectors;

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};

const context: VuartV1CommandContext = {
  ...binding,
  providerOperationId: "operation-1",
  commandId: "command-1",
  idempotencyKey: "air-command:comm-1:3:1",
};

describe("Air VUART v1 command golden vectors", () => {
  it("matches every frozen control payload and complete envelope", () => {
    const payloads: Record<CommandVectorName, Uint8Array> = {
      hello: encodeVuartV1HelloPayload({
        deviceId: "air-780-1",
        bootId: "boot-1",
        firmwareVersion: "000.999.007",
        protocolVersion: 1,
        capabilityFlags: 0x03,
        maxPayloadBytes: 6_461,
      }),
      heartbeatInCall: encodeVuartV1HeartbeatPayload({
        deviceId: "air-780-1",
        bootId: "boot-1",
        heartbeatSequence: 0x01020304,
        uptimeMs: 0x0102030405060708n,
        deviceState: "in_call",
        activeBinding: binding,
      }),
      dial: encodeVuartV1CommandPayload({ ...context, type: "dial",
        dialTargetE164: "+8613800138000" }),
      hangup: encodeVuartV1CommandPayload({ ...context, type: "hangup" }),
      dtmf: encodeVuartV1CommandPayload({ ...context, type: "dtmf", digits: "12#A" }),
      ackDial: encodeVuartV1AckPayload({ ...context,
        requestFrameSequence: 0x10203040, commandType: "dial", result: "applied" }),
      errorConflict: encodeVuartV1ErrorPayload({ ...context,
        requestFrameSequence: 0x11223344, commandType: "dial",
        errorCode: "idempotency_conflict" }),
    };

    for (const name of Object.keys(payloads) as CommandVectorName[]) {
      const vector = golden.vectors[name];
      const payload = payloads[name];
      expect(payload.byteLength, name).toBe(vector.payloadBytes);
      expect(toHex(payload), name).toBe(vector.payloadHex);
      const frame = encodeVuartFrame({
        type: vector.frameType,
        flags: vector.frame.flags,
        sequence: vector.frame.sequence,
        timestampMs: BigInt(vector.frame.timestampMs),
        payload,
      });
      expect(frame.byteLength, name).toBe(vector.frameBytes);
      expect(toHex(frame), name).toBe(vector.frameHex);
    }
  });

  it("keeps the command Lua golden table synchronized", () => {
    const lua = readFileSync(new URL(
      "../../../../firmware/air780-livekit-bridge/vuart_v1_command_golden_vectors.lua",
      import.meta.url,
    ), "utf8");
    expect(lua).toContain(`schema = "${golden.schema}"`);
    expect(lua).toContain(`status = "${golden.status}"`);
    for (const [name, vector] of Object.entries(golden.vectors)) {
      expect(lua).toContain(`${luaName(name)} = {`);
      expect(lua).toContain(`payload_hex = "${vector.payloadHex}"`);
      expect(lua).toContain(`frame_hex = "${vector.frameHex}"`);
    }
  });
});

describe("Air VUART v1 device status payloads", () => {
  it("round-trips HELLO without claiming unverified audio injection", () => {
    const input = {
      deviceId: "air-780-1",
      bootId: "boot-1",
      firmwareVersion: "000.999.007",
      protocolVersion: 1 as const,
      capabilityFlags: 0x03,
      maxPayloadBytes: 6_461,
    };
    expect(decodeVuartV1HelloPayload(encodeVuartV1HelloPayload(input)))
      .toEqual(input);
  });

  it("round-trips ready and active HEARTBEAT states", () => {
    const ready = {
      deviceId: "air-780-1",
      bootId: "boot-1",
      heartbeatSequence: 4,
      uptimeMs: 123_456n,
      deviceState: "ready" as const,
    };
    expect(decodeVuartV1HeartbeatPayload(
      encodeVuartV1HeartbeatPayload(ready),
    )).toEqual(ready);

    const active = { ...ready, heartbeatSequence: 5,
      deviceState: "in_call" as const, activeBinding: binding };
    expect(decodeVuartV1HeartbeatPayload(
      encodeVuartV1HeartbeatPayload(active),
    )).toEqual(active);
  });

  it("rejects invalid HELLO capabilities and heartbeat state/binding pairs", () => {
    expect(() => encodeVuartV1HelloPayload({
      deviceId: "air-780-1",
      bootId: "boot-1",
      firmwareVersion: "000.999.007",
      protocolVersion: 1,
      capabilityFlags: 0x10,
      maxPayloadBytes: 6_461,
    })).toThrow("capability");
    expect(() => encodeVuartV1HeartbeatPayload({
      deviceId: "air-780-1",
      bootId: "boot-1",
      heartbeatSequence: 1,
      uptimeMs: 1n,
      deviceState: "in_call",
    })).toThrow("binding");
  });

  it("rejects malformed status payloads before device admission", () => {
    const hello = encodeVuartV1HelloPayload({
      deviceId: "air-780-1",
      bootId: "boot-1",
      firmwareVersion: "000.999.007",
      protocolVersion: 1,
      capabilityFlags: 0x03,
      maxPayloadBytes: 6_461,
    });
    hello[hello.byteLength - 5] = 2;
    expect(() => decodeVuartV1HelloPayload(hello)).toThrow("protocol");

    const heartbeat = encodeVuartV1HeartbeatPayload({
      deviceId: "air-780-1",
      bootId: "boot-1",
      heartbeatSequence: 1,
      uptimeMs: 1n,
      deviceState: "ready",
    });
    expect(() => decodeVuartV1HeartbeatPayload(
      join(heartbeat, Uint8Array.of(0)),
    )).toThrow("trailing");
  });
});

describe("Air VUART v1 command and result payloads", () => {
  it.each([
    [VuartFrameType.DIAL, { ...context, type: "dial" as const,
      dialTargetE164: "+8613800138000" }],
    [VuartFrameType.HANGUP, { ...context, type: "hangup" as const }],
    [VuartFrameType.DTMF, { ...context, type: "dtmf" as const,
      digits: "12#A" }],
  ])("round-trips frame type %i", (frameType, command) => {
    const payload = encodeVuartV1CommandPayload(command);
    expect(decodeVuartV1CommandPayload(frameType, payload)).toEqual(command);
  });

  it("round-trips the deterministic applied ACK", () => {
    const input = {
      ...context,
      requestFrameSequence: 0x10203040,
      commandType: "dial" as const,
      result: "applied" as const,
    };
    expect(decodeVuartV1AckPayload(encodeVuartV1AckPayload(input)))
      .toEqual(input);
  });

  it("round-trips every correlated ERROR code", () => {
    for (const errorCode of [
      "unsupported_command", "stale_fence", "binding_mismatch",
      "stale_generation", "idempotency_conflict", "invalid_state",
      "invalid_argument", "internal_error",
    ] as const) {
      const input = { ...context, requestFrameSequence: 9,
        commandType: "dtmf" as const, errorCode };
      expect(decodeVuartV1ErrorPayload(encodeVuartV1ErrorPayload(input)))
        .toEqual(input);
    }
  });

  it("rejects dangerous command arguments and unsupported frame types", () => {
    expect(() => encodeVuartV1CommandPayload({
      ...context,
      type: "dial",
      dialTargetE164: "13800138000",
    })).toThrow("E.164");
    expect(() => encodeVuartV1CommandPayload({
      ...context,
      type: "dtmf",
      digits: "12X",
    })).toThrow("DTMF");
    const payload = encodeVuartV1CommandPayload({ ...context, type: "hangup" });
    expect(() => decodeVuartV1CommandPayload(
      VuartFrameType.CALL_STATE,
      payload,
    )).toThrow("type");
  });

  it("rejects truncated, trailing, and unsafe-fence command payloads", () => {
    const payload = encodeVuartV1CommandPayload({ ...context, type: "hangup" });
    expect(() => decodeVuartV1CommandPayload(
      VuartFrameType.HANGUP,
      payload.slice(0, -1),
    )).toThrow();
    expect(() => decodeVuartV1CommandPayload(
      VuartFrameType.HANGUP,
      join(payload, Uint8Array.of(0)),
    )).toThrow("trailing");
    new DataView(payload.buffer).setBigUint64(
      5,
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      true,
    );
    expect(() => decodeVuartV1CommandPayload(
      VuartFrameType.HANGUP,
      payload,
    )).toThrow("safe integer");
  });
});

function join(left: Uint8Array, right: Uint8Array) {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left);
  output.set(right, left.byteLength);
  return output;
}

function toHex(value: Uint8Array) {
  return Buffer.from(value).toString("hex");
}

function luaName(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

type CommandVectorName = keyof CommandGoldenVectors["vectors"];

interface CommandGoldenVectors {
  schema: string;
  status: string;
  vectors: Record<"hello" | "heartbeatInCall" | "dial" | "hangup" | "dtmf" |
    "ackDial" | "errorConflict", {
      frameType: number;
      frame: { flags: number; sequence: number; timestampMs: string };
      payloadBytes: number;
      payloadHex: string;
      frameBytes: number;
      frameHex: string;
    }>;
}
