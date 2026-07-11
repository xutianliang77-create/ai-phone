import { describe, expect, test } from "vitest";
import { checkTtsProviderReadiness } from "./tts_provider_readiness.mjs";

describe("checkTtsProviderReadiness", () => {
  test("passes when VoxCPM2 returns playable PCM16 audio", async () => {
    const requests = [];
    const result = await checkTtsProviderReadiness({
      endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
      apiKey: "tts_http_api_key_123",
      timeoutMs: 1000,
      fetchFn: async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(init.body),
          headers: init.headers,
        });
        return jsonResponse(200, {
          provider: "voxcpm2",
          model: "VoxCPM2",
          firstAudioMs: 32,
          audioDurationMs: 640,
          audio: { format: "pcm16", sampleRate: 16000, data: Buffer.from([1, 0, 2, 0]).toString("base64") },
        });
      },
    });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.checks.map((check) => [check.name, check.status])).toEqual([
      ["tts_http_endpoint_configured", "pass"],
      ["tts_http_api_key_configured", "pass"],
      ["tts_http_response_ok", "pass"],
      ["tts_provider_identity", "pass"],
      ["tts_model_identity", "pass"],
      ["tts_audio_pcm16", "pass"],
      ["tts_first_audio_latency", "pass"],
    ]);
    expect(requests[0]).toMatchObject({
      url: "https://tts.qkxy.cn/voxcpm2/synthesize",
      body: { language: "en", speakerRole: "guest", segmentId: "tts-release-smoke" },
      headers: { authorization: "Bearer tts_http_api_key_123" },
    });
  });

  test("blocks missing endpoint and placeholder api key before network", async () => {
    const missingEndpoint = await checkTtsProviderReadiness({
      endpoint: "",
      apiKey: "tts_http_api_key_123",
    });
    expect(missingEndpoint.status).toBe("not_ready");
    expect(missingEndpoint.issues).toContain(
      "TTS_HTTP_ENDPOINT is required for VoxCPM2 TTS readiness.",
    );

    const placeholderKey = await checkTtsProviderReadiness({
      endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
      apiKey: "replace-with-tts-key",
      fetchFn: async () => {
        throw new Error("fetch should not be called");
      },
    });
    expect(placeholderKey.status).toBe("not_ready");
    expect(placeholderKey.issues).toContain(
      "TTS_HTTP_API_KEY is required for VoxCPM2 TTS readiness.",
    );
  });

  test("fails when identity, audio, or first audio latency is not release ready", async () => {
    const result = await checkTtsProviderReadiness({
      endpoint: "https://tts.qkxy.cn/voxcpm2/synthesize",
      apiKey: "tts_http_api_key_123",
      timeoutMs: 1000,
      fetchFn: async () => jsonResponse(200, {
        provider: "qwen3-tts",
        model: "qwen3-tts-0.6b",
        firstAudioMs: 1800,
        audio: { format: "wav", sampleRate: 48000, data: "AA==" },
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "VoxCPM2 TTS response provider must be voxcpm2.",
    );
    expect(result.issues).toContain(
      "VoxCPM2 TTS response model must be VoxCPM2.",
    );
    expect(result.issues).toContain(
      "VoxCPM2 TTS response must include playable base64 PCM16 audio at 16kHz or 24kHz.",
    );
    expect(result.issues).toContain("VoxCPM2 TTS firstAudioMs must be <= 1000ms.");
  });
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
