export const VUART_MAGIC_0 = 0x41;
export const VUART_MAGIC_1 = 0x49;
const VERSION = 1;
export const VUART_HEADER_BYTES = 20;
export const VUART_CRC_BYTES = 4;
export const VUART_MIN_FRAME_BYTES = VUART_HEADER_BYTES + VUART_CRC_BYTES;

export const VuartFrameType = {
  HELLO: 1,
  HEARTBEAT: 2,
  DIAL: 3,
  HANGUP: 4,
  DTMF: 5,
  CALL_STATE: 6,
  AUDIO_DOWNLINK: 16,
  AUDIO_UPLINK: 17,
  ACK: 32,
  ERROR: 33,
} as const;

export interface VuartFrame {
  version: 1;
  type: number;
  flags: number;
  sequence: number;
  timestampMs: bigint;
  payload: Uint8Array;
}

export function encodeVuartFrame(
  input: Omit<VuartFrame, "version">,
): Uint8Array {
  assertUnsigned(input.flags, 0xffff, "flags");
  assertUnsigned(input.sequence, 0xffffffff, "sequence");
  if (input.payload.byteLength > 0xffff) throw new Error("payload too large");
  const output = new Uint8Array(
    VUART_HEADER_BYTES + input.payload.byteLength + VUART_CRC_BYTES,
  );
  const view = new DataView(output.buffer);
  output[0] = VUART_MAGIC_0;
  output[1] = VUART_MAGIC_1;
  output[2] = VERSION;
  output[3] = input.type;
  view.setUint16(4, input.flags, true);
  view.setUint32(6, input.sequence, true);
  view.setBigUint64(10, input.timestampMs, true);
  view.setUint16(18, input.payload.byteLength, true);
  output.set(input.payload, VUART_HEADER_BYTES);
  view.setUint32(output.byteLength - VUART_CRC_BYTES, crc32(
    output.subarray(0, output.byteLength - VUART_CRC_BYTES),
  ), true);
  return output;
}

export function decodeVuartFrame(input: Uint8Array): VuartFrame {
  if (input.byteLength < VUART_MIN_FRAME_BYTES) {
    throw new Error("VUART frame truncated");
  }
  if (input[0] !== VUART_MAGIC_0 || input[1] !== VUART_MAGIC_1) {
    throw new Error("VUART magic mismatch");
  }
  if (input[2] !== VERSION) throw new Error("VUART version unsupported");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const payloadLength = view.getUint16(18, true);
  if (input.byteLength !== VUART_HEADER_BYTES + payloadLength + VUART_CRC_BYTES) {
    throw new Error("VUART payload length mismatch");
  }
  const expectedCrc = view.getUint32(input.byteLength - VUART_CRC_BYTES, true);
  const actualCrc = crc32(input.subarray(0, input.byteLength - VUART_CRC_BYTES));
  if (expectedCrc !== actualCrc) throw new Error("VUART crc32 mismatch");
  return {
    version: 1,
    type: input[3],
    flags: view.getUint16(4, true),
    sequence: view.getUint32(6, true),
    timestampMs: view.getBigUint64(10, true),
    payload: input.slice(
      VUART_HEADER_BYTES,
      VUART_HEADER_BYTES + payloadLength,
    ),
  };
}

export function vuartFrameByteLength(header: Uint8Array) {
  if (header.byteLength < VUART_HEADER_BYTES) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return VUART_HEADER_BYTES + view.getUint16(18, true) + VUART_CRC_BYTES;
}

export function pcm20msFrameBytes(sampleRate: 8_000 | 16_000) {
  return sampleRate / 50 * 2;
}

function crc32(input: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertUnsigned(value: number, maximum: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} out of range`);
  }
}
