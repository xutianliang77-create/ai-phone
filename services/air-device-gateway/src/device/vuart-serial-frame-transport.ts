import type { SerialTransport } from "./serial-transport.js";
import {
  decodeVuartFrame,
  encodeVuartFrame,
  VUART_HEADER_BYTES,
  VUART_MAGIC_0,
  VUART_MAGIC_1,
  VUART_MIN_FRAME_BYTES,
  vuartFrameByteLength,
  type VuartFrame,
} from "./vuart-frame.js";

type FrameListener = (frame: VuartFrame) => void;
type StreamErrorListener = (error: VuartStreamError) => void;
type DisconnectListener = (reason: string) => void;

export interface VuartStreamError {
  code: "invalid_frame" | "buffer_overflow";
  message: string;
  droppedBytes: number;
}

export interface VuartStreamMetrics {
  bufferedBytes: number;
  framesDecoded: number;
  invalidFrames: number;
  bufferOverflows: number;
  discardedBytes: number;
  disconnectResets: number;
}

export class VuartSerialFrameTransport {
  private buffer = new Uint8Array();
  private readonly frameListeners = new Set<FrameListener>();
  private readonly errorListeners = new Set<StreamErrorListener>();
  private readonly disconnectListeners = new Set<DisconnectListener>();
  private readonly counters = {
    framesDecoded: 0,
    invalidFrames: 0,
    bufferOverflows: 0,
    discardedBytes: 0,
    disconnectResets: 0,
  };
  private readonly maxBufferedBytes: number;

  constructor(
    private readonly transport: SerialTransport,
    options: { maxBufferedBytes?: number } = {},
  ) {
    this.maxBufferedBytes = options.maxBufferedBytes ?? 131_072;
    if (!Number.isInteger(this.maxBufferedBytes) ||
      this.maxBufferedBytes < VUART_MIN_FRAME_BYTES) {
      throw new Error("maxBufferedBytes must hold one VUART frame");
    }
    transport.onData((data) => this.consume(data));
    transport.onDisconnect((reason) => this.handleDisconnect(reason));
  }

  get path() {
    return this.transport.path;
  }

  get isOpen() {
    return this.transport.isOpen;
  }

  open() {
    return this.transport.open();
  }

  async close() {
    this.clearBuffer();
    await this.transport.close();
  }

  writeFrame(input: Omit<VuartFrame, "version">) {
    return this.transport.write(encodeVuartFrame(input));
  }

  onFrame(listener: FrameListener) {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStreamError(listener: StreamErrorListener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onDisconnect(listener: DisconnectListener) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  metrics(): VuartStreamMetrics {
    return { ...this.counters, bufferedBytes: this.buffer.byteLength };
  }

  private consume(data: Uint8Array) {
    if (data.byteLength === 0) return;
    if (this.buffer.byteLength + data.byteLength > this.maxBufferedBytes) {
      const droppedBytes = this.buffer.byteLength + data.byteLength;
      this.clearBuffer();
      this.counters.bufferOverflows += 1;
      this.counters.discardedBytes += droppedBytes;
      this.publishError({
        code: "buffer_overflow",
        message: "VUART stream buffer limit exceeded",
        droppedBytes,
      });
      return;
    }
    this.buffer = join(this.buffer, data);
    this.decodeAvailableFrames();
  }

  private decodeAvailableFrames() {
    while (this.buffer.byteLength > 0) {
      const magicOffset = findMagic(this.buffer);
      if (magicOffset < 0) {
        const retained = this.buffer.at(-1) === VUART_MAGIC_0 ? 1 : 0;
        this.discardPrefix(this.buffer.byteLength - retained);
        return;
      }
      this.discardPrefix(magicOffset);
      if (this.buffer.byteLength < VUART_HEADER_BYTES) return;
      const frameBytes = vuartFrameByteLength(this.buffer);
      if (frameBytes === null) return;
      if (frameBytes > this.maxBufferedBytes) {
        this.counters.bufferOverflows += 1;
        this.discardPrefix(1);
        this.publishError({
          code: "buffer_overflow",
          message: "VUART frame length exceeds stream buffer limit",
          droppedBytes: 1,
        });
        continue;
      }
      if (this.buffer.byteLength < frameBytes) return;
      const candidate = this.buffer.slice(0, frameBytes);
      try {
        const frame = decodeVuartFrame(candidate);
        this.buffer = this.buffer.slice(frameBytes);
        this.counters.framesDecoded += 1;
        for (const listener of this.frameListeners) listener(frame);
      } catch (error) {
        this.counters.invalidFrames += 1;
        this.discardPrefix(1);
        this.publishError({
          code: "invalid_frame",
          message: error instanceof Error ? error.message : String(error),
          droppedBytes: 1,
        });
      }
    }
  }

  private discardPrefix(bytes: number) {
    if (bytes <= 0) return;
    this.buffer = this.buffer.slice(bytes);
    this.counters.discardedBytes += bytes;
  }

  private clearBuffer() {
    this.buffer = new Uint8Array();
  }

  private publishError(error: VuartStreamError) {
    for (const listener of this.errorListeners) listener(error);
  }

  private handleDisconnect(reason: string) {
    if (this.buffer.byteLength > 0) {
      this.counters.discardedBytes += this.buffer.byteLength;
      this.clearBuffer();
    }
    this.counters.disconnectResets += 1;
    for (const listener of this.disconnectListeners) listener(reason);
  }
}

function findMagic(input: Uint8Array) {
  for (let index = 0; index + 1 < input.byteLength; index += 1) {
    if (input[index] === VUART_MAGIC_0 && input[index + 1] === VUART_MAGIC_1) {
      return index;
    }
  }
  return -1;
}

function join(left: Uint8Array, right: Uint8Array) {
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left, 0);
  output.set(right, left.byteLength);
  return output;
}
