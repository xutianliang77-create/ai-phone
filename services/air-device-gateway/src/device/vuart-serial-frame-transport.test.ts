import { describe, expect, it, vi } from "vitest";
import { FixtureSerialTransport } from "./serial-transport-fixture.js";
import {
  VuartSerialFrameTransport,
  type VuartStreamError,
} from "./vuart-serial-frame-transport.js";
import { encodeVuartFrame, VuartFrameType } from "./vuart-frame.js";

describe("Air VUART serial frame transport", () => {
  it("reassembles a frame split across arbitrary serial reads", async () => {
    const fixture = new FixtureSerialTransport("fixture://air-split");
    const transport = new VuartSerialFrameTransport(fixture);
    const onFrame = vi.fn();
    transport.onFrame(onFrame);
    await transport.open();

    const frame = encoded(11, Uint8Array.from([1, 2, 3, 4]));
    fixture.receive(Uint8Array.from([0xff, 0x00, frame[0]!]));
    fixture.receive(frame.subarray(1, 21));
    expect(onFrame).not.toHaveBeenCalled();
    fixture.receive(frame.subarray(21));

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 11,
      payload: Uint8Array.from([1, 2, 3, 4]),
    }));
  });

  it("delivers coalesced frames in device sequence order", async () => {
    const fixture = new FixtureSerialTransport("fixture://air-coalesced");
    const transport = new VuartSerialFrameTransport(fixture);
    const sequences: number[] = [];
    transport.onFrame((frame) => sequences.push(frame.sequence));
    await transport.open();

    fixture.receive(join(encoded(21), encoded(22), encoded(23)));

    expect(sequences).toEqual([21, 22, 23]);
  });

  it("drops a corrupt frame and resynchronizes at the next valid frame", async () => {
    const fixture = new FixtureSerialTransport("fixture://air-corrupt");
    const transport = new VuartSerialFrameTransport(fixture);
    const sequences: number[] = [];
    const errors: VuartStreamError[] = [];
    transport.onFrame((frame) => sequences.push(frame.sequence));
    transport.onStreamError((error) => errors.push(error));
    await transport.open();
    const corrupt = encoded(31);
    corrupt[corrupt.length - 1] ^= 0xff;

    fixture.receive(join(corrupt, encoded(32)));

    expect(sequences).toEqual([32]);
    expect(errors).toEqual([
      expect.objectContaining({ code: "invalid_frame", message: expect.stringContaining("crc32") }),
    ]);
  });

  it("clears an incomplete frame on disconnect before reconnect", async () => {
    const fixture = new FixtureSerialTransport("fixture://air-reconnect");
    const transport = new VuartSerialFrameTransport(fixture);
    const sequences: number[] = [];
    transport.onFrame((frame) => sequences.push(frame.sequence));
    await transport.open();
    const stale = encoded(41, Uint8Array.from([4, 1]));
    fixture.receive(stale.subarray(0, 12));

    fixture.disconnect("usb_reset");
    await transport.open();
    fixture.receive(encoded(42, Uint8Array.from([4, 2])));

    expect(sequences).toEqual([42]);
    expect(transport.metrics()).toMatchObject({ disconnectResets: 1, bufferedBytes: 0 });
  });

  it("bounds unread bytes and remains usable after overflow", async () => {
    const fixture = new FixtureSerialTransport("fixture://air-overflow");
    const transport = new VuartSerialFrameTransport(fixture, { maxBufferedBytes: 64 });
    const sequences: number[] = [];
    const errors: VuartStreamError[] = [];
    transport.onFrame((frame) => sequences.push(frame.sequence));
    transport.onStreamError((error) => errors.push(error));
    await transport.open();

    fixture.receive(encoded(51, new Uint8Array(80)));
    fixture.receive(encoded(52));

    expect(sequences).toEqual([52]);
    expect(errors).toEqual([
      expect.objectContaining({ code: "buffer_overflow", droppedBytes: expect.any(Number) }),
    ]);
    expect(transport.metrics()).toMatchObject({ bufferOverflows: 1, framesDecoded: 1 });
  });

  it("rejects an advertised frame larger than the buffer without blocking the next frame", async () => {
    const fixture = new FixtureSerialTransport("fixture://air-length-overflow");
    const transport = new VuartSerialFrameTransport(fixture, { maxBufferedBytes: 64 });
    const sequences: number[] = [];
    const errors: VuartStreamError[] = [];
    transport.onFrame((frame) => sequences.push(frame.sequence));
    transport.onStreamError((error) => errors.push(error));
    await transport.open();
    const oversizedHeader = encoded(53).slice(0, 20);
    new DataView(oversizedHeader.buffer).setUint16(18, 65, true);

    fixture.receive(join(oversizedHeader, encoded(54)));

    expect(sequences).toEqual([54]);
    expect(errors).toEqual([
      expect.objectContaining({ code: "buffer_overflow" }),
    ]);
  });

  it("encodes outbound commands before writing to the serial boundary", async () => {
    const fixture = new FixtureSerialTransport("fixture://air-write");
    const transport = new VuartSerialFrameTransport(fixture);
    await transport.open();

    await transport.writeFrame({
      type: VuartFrameType.HANGUP,
      flags: 0,
      sequence: 61,
      timestampMs: 61n,
      payload: Uint8Array.from([6, 1]),
    });

    expect(fixture.writes()).toEqual([encoded(
      61,
      Uint8Array.from([6, 1]),
      VuartFrameType.HANGUP,
    )]);
  });
});

function encoded(
  sequence: number,
  payload = Uint8Array.of(sequence & 0xff),
  type = VuartFrameType.AUDIO_DOWNLINK,
) {
  return encodeVuartFrame({
    type,
    flags: 0,
    sequence,
    timestampMs: BigInt(sequence),
    payload,
  });
}

function join(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
