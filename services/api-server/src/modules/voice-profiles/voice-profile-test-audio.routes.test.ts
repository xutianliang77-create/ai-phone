import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { restoreEnv, wavFixture } from "./voice-profiles.test-support.js";

describe("voice profile test audio routes", () => {
  let previousReferenceDir: string | undefined;
  let previousTtsEndpoint: string | undefined;
  let previousTtsApiKey: string | undefined;
  let originalFetch: typeof fetch;
  let referenceDir: string;

  beforeEach(() => {
    previousReferenceDir = process.env.VOICE_PROFILE_REFERENCE_DIR;
    previousTtsEndpoint = process.env.TTS_HTTP_ENDPOINT;
    previousTtsApiKey = process.env.TTS_HTTP_API_KEY;
    originalFetch = globalThis.fetch;
    referenceDir = mkdtempSync(join(tmpdir(), "ai-phone-voice-preview-"));
    process.env.VOICE_PROFILE_REFERENCE_DIR = referenceDir;
    delete process.env.TTS_HTTP_ENDPOINT;
    delete process.env.TTS_HTTP_API_KEY;
    getStoreSnapshot().voiceProfiles = [];
  });

  afterEach(() => {
    restoreEnv("VOICE_PROFILE_REFERENCE_DIR", previousReferenceDir);
    restoreEnv("TTS_HTTP_ENDPOINT", previousTtsEndpoint);
    restoreEnv("TTS_HTTP_API_KEY", previousTtsApiKey);
    globalThis.fetch = originalFetch;
    rmSync(referenceDir, { recursive: true, force: true });
  });

  it("synthesizes a playable Hi-Fi sample for a ready voice", async () => {
    process.env.TTS_HTTP_ENDPOINT = "http://tts.local/tts/synthesize";
    process.env.TTS_HTTP_API_KEY = "tts-secret";
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        text: "你好，这是我的声音试听。",
        language: "zh",
        speakerRole: "guest",
        voice: {
          mode: "ultimate_clone",
          voiceProfileId: expect.any(String),
          referenceAudioId: expect.any(String),
          referenceTranscript: "你好，我正在创建我的声音。",
          quality: "hifi",
        },
      });
      expect(init?.headers).toMatchObject({ authorization: "Bearer tts-secret" });
      return new Response(JSON.stringify({
        provider: "voxcpm2",
        model: "VoxCPM2",
        voiceMode: "ultimate_clone",
        voiceProfileId: "voice-profile-1",
        audio: { format: "pcm16", sampleRate: 24000, data: "AA==" },
      }), { status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      payload: {
        consentAccepted: true,
        consentVersion: "domestic-voice-profile-v1",
      },
    });
    await app.inject({
      method: "POST",
      url: "/voice-profiles/me/reference-audio",
      payload: {
        mimeType: "audio/wav",
        durationMs: 5000,
        audioBase64: wavFixture().toString("base64"),
        referenceTranscript: "请用自然语速朗读：你好，我正在创建我的声音。",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/voice-profiles/me/test-audio",
      payload: {},
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "voxcpm2",
      model: "VoxCPM2",
      audio: { format: "pcm16", sampleRate: 24000, data: "AA==" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects test audio before the voice profile is ready", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      payload: {
        consentAccepted: true,
        consentVersion: "domestic-voice-profile-v1",
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/voice-profiles/me/test-audio",
      payload: {},
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("voice_profile_not_ready");
  });
});
