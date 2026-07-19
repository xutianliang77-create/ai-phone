import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  account,
  restoreEnv,
  session,
  wavFixture,
} from "./voice-profiles.test-support.js";

describe("voice profile routes", () => {
  let previousReferenceDir: string | undefined;
  let previousTtsEndpoint: string | undefined;
  let previousTtsApiKey: string | undefined;
  let previousTtsReferenceUploadEndpoint: string | undefined;
  let originalFetch: typeof fetch;
  let referenceDir: string;

  beforeEach(() => {
    previousReferenceDir = process.env.VOICE_PROFILE_REFERENCE_DIR;
    previousTtsEndpoint = process.env.TTS_HTTP_ENDPOINT;
    previousTtsApiKey = process.env.TTS_HTTP_API_KEY;
    previousTtsReferenceUploadEndpoint =
      process.env.TTS_VOICE_REFERENCE_UPLOAD_ENDPOINT;
    originalFetch = globalThis.fetch;
    referenceDir = mkdtempSync(join(tmpdir(), "ai-phone-voice-profile-"));
    process.env.VOICE_PROFILE_REFERENCE_DIR = referenceDir;
    delete process.env.TTS_HTTP_ENDPOINT;
    delete process.env.TTS_HTTP_API_KEY;
    delete process.env.TTS_VOICE_REFERENCE_UPLOAD_ENDPOINT;
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.voiceProfiles = [];
  });

  afterEach(() => {
    restoreEnv("VOICE_PROFILE_REFERENCE_DIR", previousReferenceDir);
    restoreEnv("TTS_HTTP_ENDPOINT", previousTtsEndpoint);
    restoreEnv("TTS_HTTP_API_KEY", previousTtsApiKey);
    restoreEnv(
      "TTS_VOICE_REFERENCE_UPLOAD_ENDPOINT",
      previousTtsReferenceUploadEndpoint,
    );
    globalThis.fetch = originalFetch;
    rmSync(referenceDir, { recursive: true, force: true });
  });

  it("creates, reads, and deletes the current user's voice profile", async () => {
    const app = await buildApp();
    const empty = await app.inject({
      method: "GET",
      url: "/voice-profiles/me",
    });
    const created = await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      payload: {
        displayName: "我的声音",
        consentAccepted: true,
        consentVersion: "domestic-voice-profile-v1",
        consentAcceptedAt: "2026-07-07T00:00:00.000Z",
      },
    });
    const read = await app.inject({
      method: "GET",
      url: "/voice-profiles/me",
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/voice-profiles/me",
    });
    const afterDelete = await app.inject({
      method: "GET",
      url: "/voice-profiles/me",
    });
    await app.close();

    expect(empty.json().profile).toBeNull();
    expect(created.statusCode).toBe(200);
    expect(created.json().profile).toMatchObject({
      displayName: "我的声音",
      status: "pending_reference_audio",
      voiceMode: "personal_clone",
      consentVersion: "domestic-voice-profile-v1",
      consentAcceptedAt: "2026-07-07T00:00:00.000Z",
    });
    expect(read.json().profile.id).toBe(created.json().profile.id);
    expect(deleted.json().profile.status).toBe("deleted");
    expect(afterDelete.json().profile).toBeNull();
  });

  it("rejects profile creation without explicit voice consent", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      payload: { consentVersion: "domestic-voice-profile-v1" },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("voice_consent_required");
    expect(getStoreSnapshot().voiceProfiles).toHaveLength(0);
  });

  it("stores a wav reference audio upload and marks the profile ready", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      payload: {
        consentAccepted: true,
        consentVersion: "domestic-voice-profile-v1",
      },
    });
    const uploaded = await app.inject({
      method: "POST",
      url: "/voice-profiles/me/reference-audio",
      payload: {
        mimeType: "audio/wav",
        durationMs: 5000,
        audioBase64: wavFixture().toString("base64"),
        referenceTranscript: "这是一段参考音频",
      },
    });
    await app.close();

    const referenceAudioId = created.json().profile.id;
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().profile).toMatchObject({
      id: referenceAudioId,
      status: "ready",
      voiceMode: "ultimate_clone",
      referenceAudioId,
      referenceTranscript: "这是一段参考音频",
    });
    expect(readFileSync(join(referenceDir, `${referenceAudioId}.wav`))).toEqual(
      wavFixture(),
    );
  });

  it("syncs uploaded reference audio to configured TTS service", async () => {
    process.env.TTS_VOICE_REFERENCE_UPLOAD_ENDPOINT = "http://tts.local/voice-references";
    process.env.TTS_HTTP_API_KEY = "tts-secret";
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(_url.toString()).toMatch(/\/voice-references\/[-A-Za-z0-9_]+$/);
      expect(body.audioBase64).toBe(wavFixture().toString("base64"));
      expect(init?.headers).toMatchObject({
        authorization: "Bearer tts-secret",
      });
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
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
    const response = await app.inject({
      method: "POST",
      url: "/voice-profiles/me/reference-audio",
      payload: {
        mimeType: "audio/wav",
        durationMs: 5000,
        audioBase64: wavFixture().toString("base64"),
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().profile.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects unsupported reference audio uploads", async () => {
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
      url: "/voice-profiles/me/reference-audio",
      payload: {
        mimeType: "audio/mpeg",
        durationMs: 5000,
        audioBase64: wavFixture().toString("base64"),
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsupported_reference_audio_type");
  });

  it("rejects quiet reference audio before syncing it", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      payload: { consentAccepted: true, consentVersion: "domestic-voice-profile-v1" },
    });
    const response = await app.inject({
      method: "POST",
      url: "/voice-profiles/me/reference-audio",
      payload: {
        mimeType: "audio/wav",
        durationMs: 5000,
        audioBase64: wavFixture(0).toString("base64"),
      },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("voice_reference_too_quiet");
    expect(response.json().quality.accepted).toBe(false);
  });

  it("keeps voice profiles isolated by account", async () => {
    const now = "2026-07-07T00:00:00.000Z";
    const store = getStoreSnapshot();
    store.accounts = [account("user_a", now), account("user_b", now)];
    store.authSessions = [
      session("token_a", "user_a", now),
      session("token_b", "user_b", now),
    ];

    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/voice-profiles/me",
      headers: { authorization: "Bearer token_a" },
      payload: {
        displayName: "用户 A 的声音",
        consentAccepted: true,
        consentVersion: "domestic-voice-profile-v1",
      },
    });
    const other = await app.inject({
      method: "GET",
      url: "/voice-profiles/me",
      headers: { authorization: "Bearer token_b" },
    });
    await app.close();

    expect(created.json().profile).toMatchObject({
      displayName: "用户 A 的声音",
      status: "pending_reference_audio",
    });
    expect(other.json().profile).toBeNull();
  });

});
