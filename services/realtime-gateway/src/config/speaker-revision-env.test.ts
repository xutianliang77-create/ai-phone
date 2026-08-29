import { describe, expect, it } from "vitest";
import { loadSpeakerRevisionEnv } from "./speaker-revision-env.js";

describe("speaker revision environment", () => {
  it("is inert by default", () => {
    expect(loadSpeakerRevisionEnv({})).toEqual({
      speakerRevisionProvider: "off",
      speakerRevisionMode: "shadow",
      speakerRevisionHttpEndpoint: undefined,
      speakerRevisionHealthUrl: undefined,
      speakerRevisionHttpApiKey: undefined,
      speakerRevisionHttpTimeoutMs: 15_000,
      speakerRevisionWindowMs: 90_000,
      speakerRevisionTokenSplitEnabled: false,
    });
  });

  it("parses an explicit apply candidate", () => {
    expect(loadSpeakerRevisionEnv({
      SPEAKER_REVISION_PROVIDER: "http",
      SPEAKER_REVISION_MODE: "apply",
      SPEAKER_REVISION_HTTP_ENDPOINT: "http://127.0.0.1:18126/revision",
      SPEAKER_REVISION_HEALTH_URL: "http://127.0.0.1:18126/health",
      SPEAKER_REVISION_HTTP_TIMEOUT_MS: "30000",
      SPEAKER_REVISION_WINDOW_MS: "60000",
      SPEAKER_REVISION_TOKEN_SPLIT_ENABLED: "true",
    })).toMatchObject({
      speakerRevisionProvider: "http",
      speakerRevisionMode: "apply",
      speakerRevisionHttpTimeoutMs: 30_000,
      speakerRevisionWindowMs: 60_000,
      speakerRevisionTokenSplitEnabled: true,
    });
  });

  it("rejects unsupported provider and mode values", () => {
    expect(() => loadSpeakerRevisionEnv({
      SPEAKER_REVISION_PROVIDER: "moss",
    })).toThrow("SPEAKER_REVISION_PROVIDER");
    expect(() => loadSpeakerRevisionEnv({
      SPEAKER_REVISION_MODE: "force",
    })).toThrow("SPEAKER_REVISION_MODE");
  });
});
