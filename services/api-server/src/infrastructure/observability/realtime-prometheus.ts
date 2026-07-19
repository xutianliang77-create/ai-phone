import type { RealtimeNodeDiagnosticsDto } from "@translation/contracts";

const MAX_RETAINED_RUNTIMES = 4_096;
const runtimes = new Map<string, RealtimeNodeDiagnosticsDto>();

export function observeRealtimeRuntime(node: RealtimeNodeDiagnosticsDto) {
  runtimes.delete(node.runtimeId);
  runtimes.set(node.runtimeId, structuredClone(node));
  while (runtimes.size > MAX_RETAINED_RUNTIMES) {
    const oldest = runtimes.keys().next().value;
    if (!oldest) break;
    runtimes.delete(oldest);
  }
}

export function renderRealtimePrometheusMetrics() {
  const byNode = new Map<string, RealtimeNodeDiagnosticsDto[]>();
  for (const node of runtimes.values()) {
    byNode.set(node.nodeId, [...(byNode.get(node.nodeId) ?? []), node]);
  }
  const lines = [
    "# HELP wujie_realtime_runtime_count Retained completed Worker runtimes.",
    "# TYPE wujie_realtime_runtime_count gauge",
  ];
  for (const [nodeId, nodes] of sortedEntries(byNode)) {
    lines.push(metric("wujie_realtime_runtime_count", { worker_node: nodeId }, nodes.length));
  }
  emitAudioMetrics(lines, byNode);
  emitRtcMetrics(lines, byNode);
  emitModelMetrics(lines, byNode);
  return `${lines.join("\n")}\n`;
}

export function resetRealtimePrometheusMetricsForTests() {
  runtimes.clear();
}

function emitAudioMetrics(
  lines: string[],
  byNode: Map<string, RealtimeNodeDiagnosticsDto[]>,
) {
  lines.push(
    "# HELP wujie_realtime_audio_leg_count Retained audio legs by Worker node.",
    "# TYPE wujie_realtime_audio_leg_count gauge",
    "# HELP wujie_realtime_audio_frames Audio frame accounting by state.",
    "# TYPE wujie_realtime_audio_frames gauge",
    "# HELP wujie_realtime_backpressure_events Audio ingest backpressure events.",
    "# TYPE wujie_realtime_backpressure_events gauge",
    "# HELP wujie_realtime_audio_high_watermark_ratio Maximum retained queue watermark ratio.",
    "# TYPE wujie_realtime_audio_high_watermark_ratio gauge",
  );
  for (const [nodeId, nodes] of sortedEntries(byNode)) {
    const legs = nodes.flatMap((node) => node.audioLegs);
    lines.push(metric("wujie_realtime_audio_leg_count", { worker_node: nodeId }, legs.length));
    const states = {
      received: sum(legs.map((leg) => leg.receivedFrames)),
      processed: sum(legs.map((leg) => leg.processedFrames)),
      failed: sum(legs.map((leg) => leg.failedFrames)),
      dropped: sum(legs.map((leg) => leg.droppedFrames)),
      sequence_gap: sum(legs.map((leg) => leg.sequenceGapFrames)),
    };
    for (const [state, value] of Object.entries(states)) {
      lines.push(metric("wujie_realtime_audio_frames", {
        worker_node: nodeId,
        state,
      }, value));
    }
    lines.push(metric("wujie_realtime_backpressure_events", {
      worker_node: nodeId,
    }, sum(legs.map((leg) => leg.backpressureEvents))));
    lines.push(metric("wujie_realtime_audio_high_watermark_ratio", {
      worker_node: nodeId,
    }, rounded(Math.max(0, ...legs.map((leg) =>
      leg.highWatermarkFrames / leg.capacityFrames
    )))));
  }
}

function emitRtcMetrics(
  lines: string[],
  byNode: Map<string, RealtimeNodeDiagnosticsDto[]>,
) {
  lines.push(
    "# HELP wujie_realtime_rtc_samples RTC sample accounting by state.",
    "# TYPE wujie_realtime_rtc_samples gauge",
    "# HELP wujie_realtime_rtc_rtt_ms Retained RTC RTT quantiles in milliseconds.",
    "# TYPE wujie_realtime_rtc_rtt_ms gauge",
    "# HELP wujie_realtime_rtc_jitter_ms Retained RTC jitter quantiles in milliseconds.",
    "# TYPE wujie_realtime_rtc_jitter_ms gauge",
    "# HELP wujie_realtime_rtc_packet_loss_ratio Latest cumulative packet loss ratio.",
    "# TYPE wujie_realtime_rtc_packet_loss_ratio gauge",
  );
  for (const [nodeId, nodes] of sortedEntries(byNode)) {
    const samples = nodes.flatMap((node) => node.rtc?.samples ?? []);
    const states = {
      attempted: sum(nodes.map((node) => node.rtc?.attemptedSampleCount ?? 0)),
      retained: samples.length,
      unavailable: sum(nodes.map((node) => node.rtc?.unavailableSampleCount ?? 0)),
      discarded: sum(nodes.map((node) => node.rtc?.discardedSampleCount ?? 0)),
    };
    for (const [state, value] of Object.entries(states)) {
      lines.push(metric("wujie_realtime_rtc_samples", {
        worker_node: nodeId,
        state,
      }, value));
    }
    emitQuantiles(lines, "wujie_realtime_rtc_rtt_ms", nodeId,
      samples.flatMap((sample) => sample.rttMs === undefined ? [] : [sample.rttMs]));
    emitQuantiles(lines, "wujie_realtime_rtc_jitter_ms", nodeId,
      samples.flatMap((sample) => sample.jitterMs === undefined ? [] : [sample.jitterMs]));
    const latest = nodes.flatMap((node) => {
      const sample = node.rtc?.samples.at(-1);
      return sample ? [sample] : [];
    });
    const received = sum(latest.map((sample) => sample.packetsReceived ?? 0));
    const lost = sum(latest.map((sample) => sample.packetsLost ?? 0));
    lines.push(metric("wujie_realtime_rtc_packet_loss_ratio", {
      worker_node: nodeId,
    }, rounded(lost / Math.max(1, received + lost))));
  }
}

function emitModelMetrics(
  lines: string[],
  byNode: Map<string, RealtimeNodeDiagnosticsDto[]>,
) {
  lines.push(
    "# HELP wujie_realtime_model_config_info Worker-selected model configuration fingerprints.",
    "# TYPE wujie_realtime_model_config_info gauge",
  );
  for (const [nodeId, nodes] of sortedEntries(byNode)) {
    const counts = new Map<string, { labels: Record<string, string>; count: number }>();
    for (const item of nodes.flatMap((node) => node.modelFingerprints)) {
      const labels = {
        worker_node: nodeId,
        stage: item.stage,
        provider: item.provider,
        model: item.model ?? "",
        profile: item.profile ?? "",
        configuration_fingerprint: item.fingerprint,
      };
      const key = JSON.stringify(labels);
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { labels, count: 1 });
    }
    for (const { labels, count } of [...counts.values()].sort((left, right) =>
      JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels)))) {
      lines.push(metric("wujie_realtime_model_config_info", labels, count));
    }
  }
}

function emitQuantiles(
  lines: string[],
  name: string,
  nodeId: string,
  values: number[],
) {
  if (values.length === 0) return;
  const ordered = [...values].sort((left, right) => left - right);
  lines.push(metric(name, { worker_node: nodeId, quantile: "0.5" },
    percentile(ordered, 0.5)));
  lines.push(metric(name, { worker_node: nodeId, quantile: "0.95" },
    percentile(ordered, 0.95)));
}

function metric(name: string, labels: Record<string, string>, value: number) {
  const rendered = Object.entries(labels).map(([key, item]) =>
    `${key}="${escapeLabel(item)}"`
  ).join(",");
  return `${name}{${rendered}} ${value}`;
}

function escapeLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function sortedEntries<T>(value: Map<string, T>) {
  return [...value.entries()].sort(([left], [right]) => left.localeCompare(right));
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
