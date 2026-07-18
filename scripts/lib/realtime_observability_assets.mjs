import { readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED_JOBS = [
  "wujie-api-realtime",
  "wujie-asr-model",
  "wujie-translation-model",
  "wujie-tts-model",
];

const REQUIRED_TARGETS = [
  "API_METRICS_TARGET",
  "ASR_METRICS_TARGET",
  "TRANSLATION_METRICS_TARGET",
  "TTS_METRICS_TARGET",
];

const DASHBOARD_METRICS = [
  "wujie_model_service_up",
  "wujie_model_service_info",
  "wujie_realtime_runtime_count",
  "wujie_realtime_audio_frames",
  "wujie_realtime_backpressure_events",
  "wujie_realtime_rtc_samples",
  "wujie_realtime_rtc_rtt_ms",
  "wujie_realtime_rtc_jitter_ms",
  "wujie_realtime_rtc_packet_loss_ratio",
  "wujie_realtime_model_config_info",
];

export function checkRealtimeObservabilityAssets(root) {
  const contractPath = path.join(
    root,
    "infra/observability/realtime-metrics-contract.json",
  );
  const collectorPath = path.join(
    root,
    "infra/observability/otel-collector-realtime.yaml",
  );
  const dashboardPath = path.join(
    root,
    "infra/observability/grafana/realtime-quality-dashboard.json",
  );
  const sourcePaths = [
    "services/api-server/src/infrastructure/observability/realtime-prometheus.ts",
    "services/model-services/asr-service/app/runtime_observability.py",
    "services/model-services/translation-service/app/runtime_observability.py",
    "services/model-services/tts-service/app/runtime_observability.py",
  ];
  return validateRealtimeObservabilityAssets({
    contract: JSON.parse(readFileSync(contractPath, "utf8")),
    collector: readFileSync(collectorPath, "utf8"),
    dashboard: JSON.parse(readFileSync(dashboardPath, "utf8")),
    sources: sourcePaths.map((item) => readFileSync(path.join(root, item), "utf8")),
  });
}

export function validateRealtimeObservabilityAssets(input) {
  const issues = [];
  const metrics = input.contract?.metrics;
  if (input.contract?.schemaVersion !== 1 || !Array.isArray(metrics) ||
    metrics.length === 0 || new Set(metrics).size !== metrics.length) {
    issues.push("metrics contract must contain unique schema-v1 metric names");
  }
  if (input.contract?.rtcThresholdPolicy?.status !== "calibration_required" ||
    input.contract?.rtcThresholdPolicy?.thresholds !== null) {
    issues.push("RTC thresholds must remain unset until staging calibration");
  }
  const source = input.sources.join("\n");
  for (const metric of metrics ?? []) {
    if (!source.includes(metric)) issues.push(`metric is not implemented: ${metric}`);
  }
  const dashboardText = JSON.stringify(input.dashboard);
  for (const metric of DASHBOARD_METRICS) {
    if (!dashboardText.includes(metric)) issues.push(`dashboard metric missing: ${metric}`);
  }
  if (dashboardText.includes('"alert":') || dashboardText.includes('"thresholds":')) {
    issues.push("dashboard must not define uncalibrated RTC alert thresholds");
  }
  for (const label of input.contract?.cardinalityPolicy?.forbiddenLabels ?? []) {
    if (dashboardText.includes(label)) issues.push(`dashboard uses forbidden label: ${label}`);
  }
  for (const job of REQUIRED_JOBS) {
    if (!input.collector.includes(`job_name: ${job}`)) {
      issues.push(`OTel collector scrape job missing: ${job}`);
    }
  }
  for (const target of REQUIRED_TARGETS) {
    if (!input.collector.includes(`\${env:${target}}`)) {
      issues.push(`OTel collector target env missing: ${target}`);
    }
  }
  if (!input.collector.includes("exporters: [otlphttp/metrics]") ||
    !input.collector.includes(
      'metrics_endpoint: "${env:OTEL_METRICS_EXPORT_ENDPOINT}"',
    )) {
    issues.push("OTel metrics exporter is not connected to the metrics pipeline");
  }
  if (!input.collector.includes('credentials: "${env:METRICS_BEARER_TOKEN}"')) {
    issues.push("Prometheus scrape bearer token must come from the environment");
  }
  if (!input.collector.includes('host: "127.0.0.1"') ||
    !input.collector.includes("port: 18888") ||
    input.collector.includes("port: 8888")) {
    issues.push("OTel collector internal metrics must use isolated port 18888");
  }
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    issueCount: issues.length,
    metricCount: Array.isArray(metrics) ? metrics.length : 0,
    panelCount: Array.isArray(input.dashboard?.panels) ? input.dashboard.panels.length : 0,
    scrapeJobCount: REQUIRED_JOBS.filter((job) =>
      input.collector.includes(`job_name: ${job}`)
    ).length,
    thresholdsCalibrated: false,
    issues,
  };
}
