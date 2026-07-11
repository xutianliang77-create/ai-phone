const defaultSmokeText = "Hello, this is a domestic TTS release smoke test.";

export async function checkTtsProviderReadiness(options = {}) {
  const config = normalizeConfig(options);
  const checks = [];
  const issues = [];
  const actions = [];

  if (!config.endpoint) {
    record(checks, "tts_http_endpoint_configured", false, {});
    issues.push("TTS_HTTP_ENDPOINT is required for VoxCPM2 TTS readiness.");
    actions.push("Deploy the VoxCPM2 HTTP TTS service and set TTS_HTTP_ENDPOINT.");
    return result(config, checks, issues, actions);
  }
  record(checks, "tts_http_endpoint_configured", true, { endpoint: maskUrl(config.endpoint) });

  if (config.requireApiKey && !hasRealValue(config.apiKey)) {
    record(checks, "tts_http_api_key_configured", false, {});
    issues.push("TTS_HTTP_API_KEY is required for VoxCPM2 TTS readiness.");
    actions.push("Set a real TTS_HTTP_API_KEY and rerun TTS readiness.");
    return result(config, checks, issues, actions);
  }
  if (config.requireApiKey) {
    record(checks, "tts_http_api_key_configured", true, { configured: true });
  }

  try {
    const startedAt = Date.now();
    const response = await requestTts(config);
    const latencyMs = Date.now() - startedAt;
    record(checks, "tts_http_response_ok", response.status >= 200 && response.status < 300, {
      httpStatus: response.status,
      latencyMs,
    });
    const body = response.body;
    validateIdentity({ body, config, checks, issues });
    validateAudio({ body, config, checks, issues });
  } catch (error) {
    record(checks, "tts_http_response_ok", false, { message: errorMessage(error) });
    issues.push(`VoxCPM2 TTS readiness failed: ${errorMessage(error)}`);
    actions.push("Verify TTS_HTTP_ENDPOINT, TTS_HTTP_API_KEY, network access, and VoxCPM2 service logs.");
  }

  if (issues.length > 0) {
    actions.push("Rerun npm run check:tts-provider -- --json after fixing the TTS service.");
  }
  return result(config, checks, issues, actions);
}

function normalizeConfig(options) {
  return {
    endpoint: String(options.endpoint ?? "").trim(),
    apiKey: options.apiKey,
    provider: options.provider ?? "voxcpm2",
    model: options.model ?? "VoxCPM2",
    timeoutMs: Number(options.timeoutMs ?? 5000),
    maxFirstAudioMs: Number(options.maxFirstAudioMs ?? 1000),
    requireApiKey: options.requireApiKey !== false,
    fetchFn: options.fetchFn ?? fetch,
    text: options.text ?? defaultSmokeText,
    language: options.language ?? "en",
    speakerRole: options.speakerRole ?? "guest",
    segmentId: options.segmentId ?? "tts-release-smoke",
  };
}

async function requestTts(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await config.fetchFn(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        text: config.text,
        language: config.language,
        speakerRole: config.speakerRole,
        segmentId: config.segmentId,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `TTS HTTP returned HTTP ${response.status}`);
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function validateIdentity({ body, config, checks, issues }) {
  const providerOk = String(body?.provider ?? "").toLowerCase() ===
    String(config.provider).toLowerCase();
  record(checks, "tts_provider_identity", providerOk, {
    expected: config.provider,
    actual: body?.provider ?? null,
  });
  if (!providerOk) {
    issues.push(`VoxCPM2 TTS response provider must be ${config.provider}.`);
  }

  const modelOk = body?.model === config.model;
  record(checks, "tts_model_identity", modelOk, {
    expected: config.model,
    actual: body?.model ?? null,
  });
  if (!modelOk) issues.push(`VoxCPM2 TTS response model must be ${config.model}.`);
}

function validateAudio({ body, config, checks, issues }) {
  const audio = body?.audio ?? {};
  const sampleRateOk = audio.sampleRate === 16000 || audio.sampleRate === 24000;
  const formatOk = audio.format === "pcm16";
  const payload = decodeBase64(audio.data);
  const payloadOk = payload.byteLength >= 2 && payload.byteLength % 2 === 0;
  const firstAudioMs = Number(body?.firstAudioMs);
  const firstAudioOk = Number.isFinite(firstAudioMs) &&
    firstAudioMs >= 0 &&
    firstAudioMs <= config.maxFirstAudioMs;

  record(checks, "tts_audio_pcm16", formatOk && sampleRateOk && payloadOk, {
    format: audio.format ?? null,
    sampleRate: audio.sampleRate ?? null,
    payloadBytes: payload.byteLength,
  });
  if (!formatOk || !sampleRateOk || !payloadOk) {
    issues.push("VoxCPM2 TTS response must include playable base64 PCM16 audio at 16kHz or 24kHz.");
  }

  record(checks, "tts_first_audio_latency", firstAudioOk, {
    firstAudioMs: Number.isFinite(firstAudioMs) ? firstAudioMs : null,
    maxFirstAudioMs: config.maxFirstAudioMs,
  });
  if (!firstAudioOk) {
    issues.push(`VoxCPM2 TTS firstAudioMs must be <= ${config.maxFirstAudioMs}ms.`);
  }
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value.trim()) return Buffer.alloc(0);
  try {
    return Buffer.from(value, "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function result(config, checks, issues, actions) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    endpoint: maskUrl(config.endpoint),
    provider: config.provider,
    model: config.model,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function hasRealValue(value) {
  return typeof value === "string" &&
    value.trim().length >= 16 &&
    !/required|replace|example|your-|todo|待填/i.test(value);
}

function maskUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
