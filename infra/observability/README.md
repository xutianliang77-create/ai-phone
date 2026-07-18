# Realtime observability

This directory contains the P2-A3 metrics contract, an OpenTelemetry Collector
pipeline and the Grafana dashboard for the realtime translation path.

## Runtime identity contract

ASR, translation and TTS calculate a SHA-256 fingerprint once, after startup,
from canonical JSON containing:

- signature version, service, selected provider and model version;
- the effective, non-sensitive inference and endpoint parameters used by that
  service;
- hashes of optional ASR context strings instead of their content.

The value is returned by `/health` as `runtimeFingerprint` and
`runtimeSignatureVersion`, and exported by `/metrics` as
`wujie_model_service_info`. It deliberately excludes API keys, metrics tokens,
URLs, local model paths, request text/audio and voice identity. It identifies
the selected startup configuration; it is not a checksum of model weights.

Worker-side `configuration_fingerprint` values describe the routing and
pipeline parameters effective in the Worker. They are a separate domain from
the model-service startup fingerprint and must not be compared for equality.

The translation service also exports bounded admission and micro-batch gauges
and counters. They contain no request or session labels; use them to distinguish
GPU execution saturation, queued batch work, capacity rejection and queue timeout.

## Security and cardinality

`/metrics` is disabled with HTTP 503 unless `METRICS_BEARER_TOKEN` is set. Use a
dedicated secret shared by the API, the three model services and the collector;
do not reuse a model API key. The exporter excludes call, session, runtime,
user and speech IDs from labels.

The API retains at most 4096 completed runtime reports per process. Exported
audio and RTC values are process-local gauges recomputed from that bounded
window, not durable monotonic counters. The persisted session quality report
remains the source for call-level audit and cross-node reconciliation.

## Collector configuration

Set these values in the collector environment:

| Variable | Purpose |
| --- | --- |
| `METRICS_BEARER_TOKEN` | Shared scrape-only bearer secret |
| `API_METRICS_TARGET` | API `host:port` |
| `ASR_METRICS_TARGET` | ASR `host:port` |
| `TRANSLATION_METRICS_TARGET` | translation `host:port` |
| `TTS_METRICS_TARGET` | TTS `host:port` |
| `OTEL_METRICS_EXPORT_ENDPOINT` | Complete OTLP/HTTP metrics URL, including its signal path |
| `OTEL_METRICS_EXPORT_AUTHORIZATION` | destination authorization header value |
| `DEPLOYMENT_ENVIRONMENT` | resource environment, such as `staging` |
| `PLATFORM_REGION` | resource region |

Run a compatible OpenTelemetry Collector Contrib build with:

```bash
otelcol-contrib --config infra/observability/otel-collector-realtime.yaml
```

The collector binds its internal Prometheus telemetry to
`127.0.0.1:18888`, avoiding the collector default `8888` and keeping the
diagnostic endpoint private to the host.

Import `grafana/realtime-quality-dashboard.json` into Grafana and select the
Prometheus-compatible data source receiving the OTLP metrics.

## Verification and calibration boundary

Static contract verification:

```bash
npm run check:realtime-observability
npx vitest run scripts/lib/realtime_observability_assets.test.mjs
```

The dashboard intentionally contains no RTC alert thresholds. RTT, jitter,
packet-loss, sample-availability, drop and backpressure limits must be calibrated
using isolated staging and owned-device sessions across direct/TURN, reconnect,
and 10 then 25/50/100 concurrent-session runs. Until that evidence exists,
`rtcThresholdPolicy.status` remains `calibration_required` and
`rtcThresholdPolicy.thresholds` remains `null`.

The collector configuration has only been statically validated in this batch;
starting it and validating real scrape/export behavior belongs to the staging
acceptance run.
