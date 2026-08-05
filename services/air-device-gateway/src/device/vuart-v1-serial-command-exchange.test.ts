import { describe, expect, it, vi } from "vitest";
import { FixtureSerialTransport } from "./serial-transport-fixture.js";
import { VuartSerialFrameTransport } from "./vuart-serial-frame-transport.js";
import {
  decodeVuartV1AckPayload,
  encodeVuartV1AckPayload,
  encodeVuartV1CommandPayload,
  type VuartV1DeviceCommand,
} from "./vuart-v1-command-payload.js";
import { VuartV1CommandReplayGuard } from "./vuart-v1-command-replay-guard.js";
import {
  VuartV1SerialCommandExchange,
} from "./vuart-v1-serial-command-exchange.js";
import { decodeVuartFrame, encodeVuartFrame, VuartFrameType } from "./vuart-frame.js";

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};

describe("VUART v1 serial command exchange", () => {
  it("correlates fragmented, coalesced, and out-of-order ACKs", async () => {
    const fixture = new FixtureSerialTransport("fixture://command-order");
    const frames = new VuartSerialFrameTransport(fixture);
    const exchange = new VuartV1SerialCommandExchange(frames);
    const guard = guardFor(binding);
    await frames.open();

    const first = exchange.exchange(request(dial("command-1"), 11));
    const second = exchange.exchange(request(dial("command-2"), 12));
    await vi.waitFor(() => expect(fixture.writes()).toHaveLength(2));
    const reply1 = await replyForWrite(fixture, guard, 0, 101);
    const reply2 = await replyForWrite(fixture, guard, 1, 102);
    const combined = join(reply2, reply1);
    fixture.receive(combined.subarray(0, 17));
    fixture.receive(combined.subarray(17));

    expect(decodeVuartV1AckPayload((await first)!.payload).commandId)
      .toBe("command-1");
    expect(decodeVuartV1AckPayload((await second)!.payload).commandId)
      .toBe("command-2");
    expect(exchange.metrics()).toMatchObject({ completedCommands: 2,
      pendingCommands: 0, peakPendingCommands: 2 });
  });

  it("quarantines forged, corrupt, stale, and late responses", async () => {
    const fixture = new FixtureSerialTransport("fixture://command-quarantine");
    const frames = new VuartSerialFrameTransport(fixture);
    const exchange = new VuartV1SerialCommandExchange(frames);
    const guard = guardFor(binding);
    await frames.open();
    const pending = exchange.exchange(request(dial("command-1"), 21));
    await vi.waitFor(() => expect(fixture.writes()).toHaveLength(1));
    const valid = await replyForWrite(fixture, guard, 0, 201);
    const decoded = decodeVuartFrame(valid);
    const ack = decodeVuartV1AckPayload(decoded.payload);
    const forged = encodeVuartFrame({
      ...decoded,
      payload: encodeVuartV1AckPayload({ ...ack, leaseId: "lease-forged" }),
    });
    fixture.receive(forged);
    const corrupt = valid.slice();
    corrupt[corrupt.length - 1] ^= 0xff;
    fixture.receive(corrupt);
    expect(exchange.metrics().pendingCommands).toBe(1);

    fixture.receive(valid);
    expect(await pending).not.toBeNull();
    fixture.receive(valid);

    expect(exchange.metrics()).toMatchObject({ invalidResponses: 1,
      quarantinedResponses: 2, lateResponses: 1, pendingCommands: 0 });
    expect(frames.metrics().invalidFrames).toBe(1);
  });

  it("cancels pending commands on disconnect and times out after reconnect", async () => {
    vi.useFakeTimers();
    try {
      const fixture = new FixtureSerialTransport("fixture://command-disconnect");
      const frames = new VuartSerialFrameTransport(fixture);
      const exchange = new VuartV1SerialCommandExchange(frames, {
        responseTimeoutMs: 100,
      });
      await frames.open();
      const disconnected = exchange.exchange(request(dial("command-1"), 31));
      await vi.waitFor(() => expect(fixture.writes()).toHaveLength(1));
      fixture.disconnect("usb_reset");
      expect(await disconnected).toBeNull();

      await frames.open();
      const timedOut = exchange.exchange(request(dial("command-2"), 32));
      await vi.advanceTimersByTimeAsync(100);
      expect(await timedOut).toBeNull();
      expect(exchange.metrics()).toMatchObject({ disconnectCancels: 1,
        timedOutCommands: 1, pendingCommands: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds pending command memory and rejects excess work", async () => {
    const fixture = new FixtureSerialTransport("fixture://command-capacity");
    const frames = new VuartSerialFrameTransport(fixture);
    const exchange = new VuartV1SerialCommandExchange(frames, {
      maxPendingCommands: 2,
      responseTimeoutMs: 60_000,
    });
    await frames.open();
    const first = exchange.exchange(request(dial("command-1"), 41));
    const second = exchange.exchange(request(dial("command-2"), 42));
    await vi.waitFor(() => expect(exchange.metrics().pendingCommands).toBe(2));

    expect(await exchange.exchange(request(dial("command-3"), 43))).toBeNull();
    expect(exchange.metrics()).toMatchObject({ pendingCommands: 2,
      capacityRejections: 1, peakPendingCommands: 2 });
    fixture.disconnect("test_complete");
    expect(await Promise.all([first, second])).toEqual([null, null]);
  });
});

function dial(commandId: string): VuartV1DeviceCommand {
  return { ...binding, providerOperationId: `operation-${commandId}`,
    commandId, idempotencyKey: `idempotency-${commandId}`,
    type: "dial", dialTargetE164: "+8613800138000" };
}

function request(command: VuartV1DeviceCommand, sequence: number) {
  return { type: VuartFrameType.DIAL, flags: 0, sequence,
    timestampMs: BigInt(sequence), payload: encodeVuartV1CommandPayload(command) };
}

function guardFor(activeBinding: typeof binding) {
  const guard = new VuartV1CommandReplayGuard(async () => ({ status: "applied" }));
  guard.bind(activeBinding);
  return guard;
}

async function replyForWrite(
  fixture: FixtureSerialTransport,
  guard: VuartV1CommandReplayGuard,
  index: number,
  responseSequence: number,
) {
  const requestFrame = decodeVuartFrame(fixture.writes()[index]!);
  const reply = (await guard.handle(requestFrame))!;
  return encodeVuartFrame({ type: reply.type, flags: 0,
    sequence: responseSequence, timestampMs: BigInt(responseSequence),
    payload: reply.payload });
}

function join(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}
