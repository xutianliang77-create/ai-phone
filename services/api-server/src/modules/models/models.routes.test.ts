import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";

describe("model routes", () => {
  let previousModelRoutingFile: string | undefined;
  let previousModelRoutingProfile: string | undefined;
  let previousTtsEndpoint: string | undefined;
  let previousTtsKey: string | undefined;
  const tempDirs: string[] = [];

  beforeEach(() => {
    previousModelRoutingFile = process.env.MODEL_ROUTING_FILE;
    previousModelRoutingProfile = process.env.MODEL_ROUTING_PROFILE;
    previousTtsEndpoint = process.env.TTS_HTTP_ENDPOINT;
    previousTtsKey = process.env.TTS_HTTP_API_KEY;
  });

  afterEach(() => {
    if (previousModelRoutingFile === undefined) {
      delete process.env.MODEL_ROUTING_FILE;
    } else {
      process.env.MODEL_ROUTING_FILE = previousModelRoutingFile;
    }
    if (previousModelRoutingProfile === undefined) {
      delete process.env.MODEL_ROUTING_PROFILE;
    } else {
      process.env.MODEL_ROUTING_PROFILE = previousModelRoutingProfile;
    }
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { force: true, recursive: true });
    }
    restoreEnv("TTS_HTTP_ENDPOINT", previousTtsEndpoint);
    restoreEnv("TTS_HTTP_API_KEY", previousTtsKey);
    vi.unstubAllGlobals();
  });

  it("returns the active ASR, translation, and TTS model route", async () => {
    process.env.MODEL_ROUTING_FILE = writeRoutingFile({
      schemaVersion: 1,
      activeProfile: "domestic_server",
      profiles: {
        domestic_server: {
          description: "Domestic server route",
          asr: choice("http_fireredasr2_aed", "FireRedASR2-AED"),
          translation: choice("hymt2_self_hosted", "tencent/Hy-MT2-1.8B"),
          tts: choice("voxcpm2", "VoxCPM2"),
        },
      },
    });

    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/models/routing",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      activeProfile: "domestic_server",
      profiles: [
        {
          name: "domestic_server",
          asr: { provider: "http_fireredasr2_aed", model: "FireRedASR2-AED" },
          translation: {
            provider: "hymt2_self_hosted",
            model: "tencent/Hy-MT2-1.8B",
          },
          tts: { provider: "voxcpm2", model: "VoxCPM2" },
        },
      ],
      issues: [],
    });
  });

  it("uses MODEL_ROUTING_PROFILE as the runtime active profile", async () => {
    process.env.MODEL_ROUTING_PROFILE = "fallback";
    process.env.MODEL_ROUTING_FILE = writeRoutingFile({
      schemaVersion: 1,
      activeProfile: "domestic_server",
      profiles: {
        domestic_server: {
          asr: choice("http_fireredasr2_aed", "FireRedASR2-AED"),
          translation: choice("hymt2_self_hosted", "tencent/Hy-MT2-1.8B"),
          tts: choice("voxcpm2", "VoxCPM2"),
        },
        fallback: {
          asr: choice("http_sensevoice", "iic/SenseVoiceSmall"),
          translation: choice("hymt2_self_hosted", "tencent/Hy-MT2-1.8B"),
          tts: choice("voxcpm2", "VoxCPM2"),
        },
      },
    });

    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/models/routing",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().activeProfile).toBe("fallback");
  });

  it("returns not_ready without exposing env values when routing is invalid", async () => {
    process.env.MODEL_ROUTING_FILE = writeRoutingFile({
      schemaVersion: 1,
      activeProfile: "missing",
      profiles: {
        domestic_server: {
          asr: choice("http", "FireRedASR2-AED"),
          translation: choice("hymt2_self_hosted", "tencent/Hy-MT2-1.8B"),
          tts: choice("voxcpm2", "VoxCPM2"),
          env: {
            gateway: {
              ASR_HTTP_API_KEY: "secret-api-key",
            },
          },
        },
      },
    });

    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/models/routing",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("not_ready");
    expect(response.json().issues).toContain(
      "model routing activeProfile must exist",
    );
    expect(response.body).not.toContain("secret-api-key");
  });

  it("proxies the sanitized provider voice preset catalog", async () => {
    process.env.TTS_HTTP_ENDPOINT = "http://models.local:8002/tts/synthesize";
    process.env.TTS_HTTP_API_KEY = "tts-secret";
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://models.local:8002/voice-presets");
      expect(init?.headers).toEqual({ authorization: "Bearer tts-secret" });
      return new Response(JSON.stringify({
        version: "catalog-v1",
        defaultPresetId: "warm_voice",
        presets: [{
          id: "warm_voice",
          labels: { zh: "温暖女声", en: "Warm female" },
          gender: "female",
          tone: "natural",
          scenario: "conversation",
          accent: "mandarin",
          languages: ["zh", "en"],
          provider: "voxcpm2",
          model: "VoxCPM2",
          version: "catalog-v1",
        }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", providerFetch);

    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/voice-presets" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: "catalog-v1",
      defaultPresetId: "warm_voice",
      presets: [{ id: "warm_voice", labels: { zh: "温暖女声" } }],
    });
    expect(response.body).not.toContain("referenceAudioId");
  });

  function writeRoutingFile(body: unknown) {
    const dir = mkdtempSync(join(tmpdir(), "translation-model-routing-"));
    tempDirs.push(dir);
    const file = join(dir, "model-routing.json");
    writeFileSync(file, JSON.stringify(body, null, 2));
    return file;
  }
});

function choice(provider: string, model: string) {
  return {
    provider,
    model,
    contract: "test contract",
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
