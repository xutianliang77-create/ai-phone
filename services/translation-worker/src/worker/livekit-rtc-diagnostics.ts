import type {
  RealtimeRtcDiagnosticsDto,
  RealtimeRtcSampleDto,
} from "@translation/contracts";

const MAX_RTC_SAMPLES = 120;

interface RtcStatsRoom {
  getRtcStats?: () => Promise<unknown>;
}

export class LiveKitRtcDiagnosticsCollector {
  private readonly samples: RealtimeRtcSampleDto[] = [];
  private attemptedSampleCount = 0;
  private unavailableSampleCount = 0;
  private discardedSampleCount = 0;
  private activeSample: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly room: RtcStatsRoom,
    private readonly intervalMs: number,
    private readonly nowMs: () => number = Date.now,
  ) {}

  start() {
    void this.sample();
    if (!this.room.getRtcStats) return;
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<RealtimeRtcDiagnosticsDto> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeSample;
    if (this.room.getRtcStats) await this.sample();
    return {
      attemptedSampleCount: this.attemptedSampleCount,
      unavailableSampleCount: this.unavailableSampleCount,
      discardedSampleCount: this.discardedSampleCount,
      samples: [...this.samples],
    };
  }

  private sample() {
    if (this.activeSample) return this.activeSample;
    this.activeSample = this.collect().finally(() => {
      this.activeSample = undefined;
    });
    return this.activeSample;
  }

  private async collect() {
    this.attemptedSampleCount += 1;
    try {
      const stats = await this.room.getRtcStats?.();
      const sample = extractRtcSample(stats, this.nowMs());
      if (!sample) {
        this.unavailableSampleCount += 1;
        return;
      }
      this.samples.push(sample);
      if (this.samples.length > MAX_RTC_SAMPLES) {
        this.samples.shift();
        this.discardedSampleCount += 1;
      }
    } catch {
      this.unavailableSampleCount += 1;
    }
  }
}

export function extractRtcSample(
  value: unknown,
  observedAtMs: number,
): RealtimeRtcSampleDto | undefined {
  if (!isRecord(value)) return undefined;
  const stats = [
    ...(Array.isArray(value.publisherStats) ? value.publisherStats : []),
    ...(Array.isArray(value.subscriberStats) ? value.subscriberStats : []),
  ];
  const rttSeconds: number[] = [];
  let packetsReceived = 0;
  let packetsLost = 0;
  let weightedJitterSeconds = 0;
  let jitterWeight = 0;
  for (const entry of stats) {
    if (!isRecord(entry) || !isRecord(entry.stats)) continue;
    const detail = entry.stats;
    if (!isRecord(detail.value)) continue;
    if (detail.case === "candidatePair" && isRecord(detail.value.candidatePair)) {
      pushMetric(rttSeconds, detail.value.candidatePair.currentRoundTripTime);
    }
    if ((detail.case === "remoteInboundRtp" ||
      detail.case === "remoteOutboundRtp") && isAudioRtp(detail.value)) {
      const remote = detail.case === "remoteInboundRtp"
        ? detail.value.remoteInbound : detail.value.remoteOutbound;
      if (isRecord(remote)) pushMetric(rttSeconds, remote.roundTripTime);
    }
    if (detail.case !== "inboundRtp" || !isAudioRtp(detail.value) ||
      !isRecord(detail.value.received)) continue;
    const received = count(detail.value.received.packetsReceived);
    const lost = Math.max(0, count(detail.value.received.packetsLost));
    const jitter = metric(detail.value.received.jitter);
    packetsReceived += received;
    packetsLost += lost;
    if (jitter !== undefined) {
      const weight = Math.max(1, received);
      weightedJitterSeconds += jitter * weight;
      jitterWeight += weight;
    }
  }
  const rttMs = rttSeconds.length > 0
    ? milliseconds(average(rttSeconds)) : undefined;
  const jitterMs = jitterWeight > 0
    ? milliseconds(weightedJitterSeconds / jitterWeight) : undefined;
  if (rttMs === undefined && jitterMs === undefined &&
    packetsReceived === 0 && packetsLost === 0) return undefined;
  return {
    observedAtMs,
    ...(rttMs === undefined ? {} : { rttMs }),
    ...(jitterMs === undefined ? {} : { jitterMs }),
    packetsReceived,
    packetsLost,
  };
}

function isAudioRtp(value: Record<string, unknown>) {
  return isRecord(value.stream) && value.stream.kind === "audio";
}

function pushMetric(target: number[], value: unknown) {
  const parsed = metric(value);
  if (parsed !== undefined) target.push(parsed);
}

function metric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value : undefined;
}

function count(value: unknown) {
  if (typeof value === "bigint") {
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
  }
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function milliseconds(seconds: number) {
  return Math.round(seconds * 1_000_000) / 1_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
