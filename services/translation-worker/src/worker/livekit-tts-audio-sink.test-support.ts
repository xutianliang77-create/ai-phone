export class FakeRoom {
  readonly published: Array<{ track: unknown; options: unknown }> = [];
  readonly localParticipant = {
    publishTrack: async (track: unknown, options: unknown) => {
      this.published.push({ track, options });
      return { sid: "TR_1" };
    },
  };
}

export class FakeAudioFrame {
  constructor(
    readonly data: Int16Array,
    readonly sampleRate: number,
    readonly channels: number,
    readonly samplesPerChannel: number,
  ) {}
}

export class FakeAudioSource {
  readonly captured: FakeAudioFrame[] = [];
  waited = 0;
  cleared = 0;

  constructor(
    readonly sampleRate: number,
    readonly channels: number,
    readonly captureDelayMs: number,
  ) {}

  async captureFrame(frame: FakeAudioFrame) {
    this.captured.push(frame);
    if (this.captureDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.captureDelayMs));
    }
  }

  async waitForPlayout() {
    this.waited += 1;
  }

  clearQueue() {
    this.cleared += 1;
  }
}

export function createFakeRtc(options: { captureDelayMs?: number } = {}) {
  const sources: FakeAudioSource[] = [];
  const captureDelayMs = options.captureDelayMs ?? 0;
  return {
    sources,
    AudioFrame: FakeAudioFrame,
    AudioSource: class extends FakeAudioSource {
      constructor(sampleRate: number, channels: number) {
        super(sampleRate, channels, captureDelayMs);
        sources.push(this);
      }
    },
    LocalAudioTrack: {
      createAudioTrack: (name: string, source: FakeAudioSource) => ({
        name,
        source,
      }),
    },
    TrackPublishOptions: class {
      source?: unknown;
    },
    TrackSource: { SOURCE_MICROPHONE: "microphone" },
  };
}

export function pcm16(samples: number[]) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer.toString("base64");
}

export async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 100,
) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
