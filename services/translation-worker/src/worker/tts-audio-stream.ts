import type {
  CallTtsAudioChunk,
  CallTtsAudioStream,
} from "./types.js";

export class BoundedTtsAudioStream implements CallTtsAudioStream {
  private readonly subscribers = new Set<BoundedAudioSubscriber>();
  private terminal = false;

  constructor(private readonly capacity = 8) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("TTS audio stream capacity must be a positive integer");
    }
  }

  subscribe(): AsyncIterable<CallTtsAudioChunk> {
    if (this.terminal) throw new Error("TTS audio stream is already closed");
    const subscriber = new BoundedAudioSubscriber(
      this.capacity,
      () => this.subscribers.delete(subscriber),
    );
    this.subscribers.add(subscriber);
    return subscriber;
  }

  async publish(chunk: CallTtsAudioChunk) {
    if (this.terminal) throw new Error("TTS audio stream is already closed");
    const active = [...this.subscribers].filter((subscriber) => subscriber.active);
    if (active.length === 0) throw new Error("TTS audio stream has no consumers");
    await Promise.all(active.map((subscriber) => subscriber.push(chunk)));
  }

  complete() {
    if (this.terminal) return;
    this.terminal = true;
    for (const subscriber of this.subscribers) subscriber.finish();
  }

  fail(error: unknown) {
    if (this.terminal) return;
    this.terminal = true;
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const subscriber of this.subscribers) subscriber.finish(failure);
  }
}

class BoundedAudioSubscriber implements AsyncIterable<CallTtsAudioChunk> {
  private readonly values: CallTtsAudioChunk[] = [];
  private readonly readers: Reader[] = [];
  private readonly writers: Array<() => void> = [];
  private failure?: Error;
  private finished = false;
  active = true;

  constructor(
    private readonly capacity: number,
    private readonly onClose: () => void,
  ) {}

  async push(value: CallTtsAudioChunk) {
    while (this.active && !this.finished && this.values.length >= this.capacity) {
      await new Promise<void>((resolve) => this.writers.push(resolve));
    }
    if (!this.active || this.finished) return;
    const reader = this.readers.shift();
    if (reader) reader.resolve({ value, done: false });
    else this.values.push(value);
  }

  finish(error?: Error) {
    if (this.finished) return;
    this.finished = true;
    this.failure = error;
    this.flushTerminalReaders();
    this.releaseWriters();
  }

  [Symbol.asyncIterator](): AsyncIterator<CallTtsAudioChunk> {
    return {
      next: () => this.next(),
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
    };
  }

  private async next(): Promise<IteratorResult<CallTtsAudioChunk>> {
    const value = this.values.shift();
    if (value) {
      this.writers.shift()?.();
      return { value, done: false };
    }
    if (this.failure) throw this.failure;
    if (this.finished || !this.active) return { value: undefined, done: true };
    return new Promise<IteratorResult<CallTtsAudioChunk>>((resolve, reject) => {
      this.readers.push({ resolve, reject });
    });
  }

  private close() {
    if (!this.active) return;
    this.active = false;
    this.values.length = 0;
    for (const reader of this.readers.splice(0)) {
      reader.resolve({ value: undefined, done: true });
    }
    this.releaseWriters();
    this.onClose();
  }

  private flushTerminalReaders() {
    if (this.values.length > 0) return;
    for (const reader of this.readers.splice(0)) {
      if (this.failure) reader.reject(this.failure);
      else reader.resolve({ value: undefined, done: true });
    }
  }

  private releaseWriters() {
    for (const writer of this.writers.splice(0)) writer();
  }
}

interface Reader {
  resolve: (result: IteratorResult<CallTtsAudioChunk>) => void;
  reject: (error: Error) => void;
}
