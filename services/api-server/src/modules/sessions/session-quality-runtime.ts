import type {
  RealtimeNodeDiagnosticsDto,
  SessionQualityLatencyDistributionDto,
  SessionQualityModelFingerprintDto,
  SessionQualityReportResponse,
} from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";

export function runtimeQualitySummary(session: SessionRecord) {
  const nodes = session.diagnostics?.nodes ?? [];
  if (nodes.length === 0) return { summary: {}, flags: [] as string[] };
  const legs = nodes.flatMap((node) => node.audioLegs);
  const rtcSamples = nodes.flatMap((node) => node.rtc?.samples ?? []);
  const latestRtcSamples = nodes.flatMap((node) => {
    const sample = node.rtc?.samples.at(-1);
    return sample ? [sample] : [];
  });
  const packetsReceived = sum(latestRtcSamples.map((item) => item.packetsReceived ?? 0));
  const packetsLost = sum(latestRtcSamples.map((item) => item.packetsLost ?? 0));
  const modelFingerprints = fingerprintSummary(nodes);
  const ingest = {
    nodeCount: new Set(nodes.map((node) => node.nodeId)).size,
    runtimeCount: nodes.length,
    legCount: legs.length,
    receivedFrames: sum(legs.map((leg) => leg.receivedFrames)),
    processedFrames: sum(legs.map((leg) => leg.processedFrames)),
    failedFrames: sum(legs.map((leg) => leg.failedFrames)),
    droppedFrames: sum(legs.map((leg) => leg.droppedFrames)),
    sequenceGapFrames: sum(legs.map((leg) => leg.sequenceGapFrames)),
    backpressureEvents: sum(legs.map((leg) => leg.backpressureEvents)),
    highWatermarkRatio: rounded(Math.max(0, ...legs.map((leg) =>
      leg.highWatermarkFrames / leg.capacityFrames
    ))),
  };
  const rtt = distribution(rtcSamples.flatMap((item) =>
    item.rttMs === undefined ? [] : [item.rttMs]
  ));
  const jitter = distribution(rtcSamples.flatMap((item) =>
    item.jitterMs === undefined ? [] : [item.jitterMs]
  ));
  const rtc = {
    attemptedSampleCount: sum(nodes.map(
      (node) => node.rtc?.attemptedSampleCount ?? 0,
    )),
    unavailableSampleCount: sum(nodes.map(
      (node) => node.rtc?.unavailableSampleCount ?? 0,
    )),
    discardedSampleCount: sum(nodes.map(
      (node) => node.rtc?.discardedSampleCount ?? 0,
    )),
    sampleCount: rtcSamples.length,
    ...(rtt ? { rtt } : {}),
    ...(jitter ? { jitter } : {}),
    packetsReceived,
    packetsLost,
    packetLossRate: rounded(packetsLost / Math.max(1, packetsReceived + packetsLost)),
  };
  const flags: string[] = [];
  if (ingest.sequenceGapFrames > 0) flags.push("audio_sequence_gaps");
  if (ingest.backpressureEvents > 0) flags.push("audio_backpressure");
  if (rtc.attemptedSampleCount > 0 && rtc.sampleCount === 0) {
    flags.push("rtc_metrics_unavailable");
  }
  if (hasMixedStageFingerprints(modelFingerprints)) {
    flags.push("mixed_model_fingerprints");
  }
  const summary: Partial<Pick<
    SessionQualityReportResponse,
    "ingest" | "rtc" | "modelFingerprints"
  >> = {
    ingest,
    rtc,
    ...(modelFingerprints.length > 0 ? { modelFingerprints } : {}),
  };
  return { summary, flags };
}

function fingerprintSummary(nodes: RealtimeNodeDiagnosticsDto[]) {
  const counts = new Map<string, SessionQualityModelFingerprintDto>();
  for (const node of nodes) {
    for (const item of node.modelFingerprints) {
      const key = [item.stage, item.provider, item.model, item.profile, item.fingerprint]
        .join("\u0000");
      const current = counts.get(key);
      if (current) current.runtimeCount += 1;
      else counts.set(key, { ...item, runtimeCount: 1 });
    }
  }
  return [...counts.values()].sort((left, right) =>
    `${left.stage}:${left.provider}:${left.fingerprint}`.localeCompare(
      `${right.stage}:${right.provider}:${right.fingerprint}`,
    )
  );
}

function hasMixedStageFingerprints(items: SessionQualityModelFingerprintDto[]) {
  const stages = new Map<string, Set<string>>();
  for (const item of items) {
    const fingerprints = stages.get(item.stage) ?? new Set<string>();
    fingerprints.add(item.fingerprint);
    stages.set(item.stage, fingerprints);
  }
  return [...stages.values()].some((fingerprints) => fingerprints.size > 1);
}

function distribution(values: number[]): SessionQualityLatencyDistributionDto | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  return {
    sampleCount: ordered.length,
    averageMs: Math.round(sum(ordered) / ordered.length),
    p50Ms: percentile(ordered, 0.5),
    p95Ms: percentile(ordered, 0.95),
    maxMs: ordered.at(-1) ?? 0,
  };
}

function percentile(values: number[], ratio: number) {
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)] ?? 0;
}

function sum(values: number[]) {
  return values.reduce(
    (total, value) => Math.min(Number.MAX_SAFE_INTEGER, total + value),
    0,
  );
}

function rounded(value: number) {
  return Number(value.toFixed(4));
}
