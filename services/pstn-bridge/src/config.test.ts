import { describe, expect, it } from "vitest";
import { checkReleaseReadiness, loadEnv } from "./config.js";

describe("pstn bridge config", () => {
  it("defaults to a local mock provider that is not release-ready", () => {
    const config = loadEnv({});
    const readiness = checkReleaseReadiness(config);

    expect(config).toMatchObject({ port: 3302, provider: "mock" });
    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain("pstn_bridge provider must not be mock for release");
  });

  it("accepts a real HTTP upstream release configuration", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_PORT: "3302",
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "https://pstn-provider.qkxy.cn",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS: "5000",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://pstn-provider.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
      PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED: "true",
    }));

    expect(readiness).toEqual({ status: "ready", issues: [] });
  });

  it("accepts a Fonoster-compatible release configuration", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_PORT: "3302",
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "fonoster",
      PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS: "5000",
      PSTN_BRIDGE_FONOSTER_BASE_URL: "https://fonoster-facade.qkxy.cn",
      PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID: "workspace-access-key",
      PSTN_BRIDGE_FONOSTER_API_KEY: "fonoster-api-key",
      PSTN_BRIDGE_FONOSTER_API_SECRET: "fonoster-api-secret",
      PSTN_BRIDGE_FONOSTER_APP_REF: "app-ref-1",
      PSTN_BRIDGE_FONOSTER_FROM_NUMBER: "+8610000000000",
      PSTN_BRIDGE_FONOSTER_CALL_TIMEOUT_SECONDS: "45",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://fonoster-facade.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
      PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED: "true",
    }));

    expect(readiness).toEqual({ status: "ready", issues: [] });
  });

  it("accepts a configured public media writer", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_PORT: "3302",
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "https://pstn-provider.qkxy.cn",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://pstn-provider.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_MEDIA_WRITER_TIMEOUT_MS: "3000",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
      PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED: "true",
    }));

    expect(readiness).toEqual({ status: "ready", issues: [] });
  });

  it("rejects localhost upstreams for release", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "http://127.0.0.1:9000",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    }));

    expect(readiness.issues).toContain(
      "pstn_bridge invalid PSTN_BRIDGE_UPSTREAM_BASE_URL",
    );
  });

  it("rejects incomplete Fonoster-compatible release settings", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "fonoster",
      PSTN_BRIDGE_FONOSTER_BASE_URL: "http://127.0.0.1:9000",
      PSTN_BRIDGE_FONOSTER_CALL_TIMEOUT_SECONDS: "0",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://fonoster-facade.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    }));

    expect(readiness.issues).toContain("pstn_bridge invalid PSTN_BRIDGE_FONOSTER_BASE_URL");
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID");
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_FONOSTER_API_KEY");
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_FONOSTER_API_SECRET");
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_FONOSTER_APP_REF");
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_FONOSTER_FROM_NUMBER");
    expect(readiness.issues).toContain(
      "pstn_bridge invalid PSTN_BRIDGE_FONOSTER_CALL_TIMEOUT_SECONDS",
    );
  });

  it("rejects incomplete media writer release settings", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "https://pstn-provider.qkxy.cn",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "http://127.0.0.1:9000/media/write",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    }));

    expect(readiness.issues).toContain(
      "pstn_bridge invalid PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT",
    );
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_MEDIA_WRITER_API_KEY");
  });

  it("rejects incomplete audio frame sink release settings", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "https://pstn-provider.qkxy.cn",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://pstn-provider.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "http://127.0.0.1:9000/pstn/audio-frames",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    }));

    expect(readiness.issues).toContain(
      "pstn_bridge invalid PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT",
    );
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY");
  });

  it("rejects missing provider webhook release settings", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "https://pstn-provider.qkxy.cn",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://pstn-provider.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    }));

    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET");
  });

  it("rejects incomplete status webhook release settings", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "https://pstn-provider.qkxy.cn",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://pstn-provider.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    }));

    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT");
    expect(readiness.issues).toContain("pstn_bridge missing PSTN_BRIDGE_STATUS_WEBHOOK_SECRET");
  });

  it("rejects invalid status webhook retry settings", () => {
    const readiness = checkReleaseReadiness(loadEnv({
      PSTN_BRIDGE_API_KEY: "bridge-secret",
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: "https://pstn-provider.qkxy.cn",
      PSTN_BRIDGE_UPSTREAM_API_KEY: "upstream-secret",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: "https://pstn-provider.qkxy.cn/media/write",
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: "media-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT: "https://api.qkxy.cn/webhooks/pstn/agent-calls",
      PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: "status-secret",
      PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_COUNT: "20",
      PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_DELAY_MS: "-1",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: "https://worker.qkxy.cn/pstn/audio-frames",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: "sink-secret",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    }));

    expect(readiness.issues).toContain("pstn_bridge invalid PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_COUNT");
    expect(readiness.issues).toContain("pstn_bridge invalid PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_DELAY_MS");
  });
});
