import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { recoverPendingVoiceIdentityDeletions } from "./voice-identity-deletion-recovery.js";

const provider = vi.hoisted(() => ({
  enroll: vi.fn(),
  match: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./voice-identity-provider.js", () => ({
  enrollVoiceIdentity: provider.enroll,
  matchVoiceIdentity: provider.match,
  deleteVoiceIdentityEmbedding: provider.remove,
}));

describe("voice identity routes", () => {
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "voice-identity-internal-secret";
    provider.enroll.mockReset().mockResolvedValue("embedding-a");
    provider.match.mockReset().mockResolvedValue({
      embeddingRef: "embedding-a",
      confidence: 0.91,
    });
    provider.remove.mockReset().mockResolvedValue(undefined);
    const store = getStoreSnapshot();
    store.accounts = [account("user-a"), account("user-b")];
    store.authSessions = [session("token-a", "user-a"), session("token-b", "user-b")];
    store.voiceIdentities = [];
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previousSecret;
  });

  it("isolates enrolled identities by account and stops matching after revoke", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/voice-identities",
      headers: auth("token-a"),
      payload: {
        displayName: "张经理",
        consentAccepted: true,
        consentVersion: "voice-identity-v1",
      },
    });
    const identityId = created.json().identity.id as string;
    const enrolled = await app.inject({
      method: "POST",
      url: `/voice-identities/${identityId}/reference-audio`,
      headers: auth("token-a"),
      payload: { audioBase64: wavFixture().toString("base64") },
    });
    const otherAccount = await app.inject({
      method: "GET",
      url: "/voice-identities",
      headers: auth("token-b"),
    });
    const unauthorized = await matchRequest(app, wavFixture(), undefined);
    const matched = await matchRequest(app, wavFixture(), "voice-identity-internal-secret");
    const revoked = await app.inject({
      method: "POST",
      url: `/voice-identities/${identityId}/revoke`,
      headers: auth("token-a"),
    });
    const afterRevoke = await matchRequest(
      app,
      wavFixture(),
      "voice-identity-internal-secret",
    );
    await app.close();

    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.json().identity).toMatchObject({
      id: identityId,
      displayName: "张经理",
      status: "ready",
    });
    expect(otherAccount.json().identities).toEqual([]);
    expect(unauthorized.statusCode).toBe(401);
    expect(matched.json()).toMatchObject({
      identity: { id: identityId, displayName: "张经理" },
      confidence: 0.91,
    });
    expect(revoked.json().identity.status).toBe("revoked");
    expect(afterRevoke.json()).toEqual({ identity: null, confidence: 0 });
    expect(provider.remove).toHaveBeenCalledWith("embedding-a");
  });

  it("does not reactivate an identity revoked during enrollment", async () => {
    let finishEnrollment!: (value: string) => void;
    provider.enroll.mockReturnValue(new Promise<string>((resolve) => {
      finishEnrollment = resolve;
    }));
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/voice-identities",
      headers: auth("token-a"),
      payload: {
        displayName: "并发测试",
        consentAccepted: true,
        consentVersion: "voice-identity-v1",
      },
    });
    const identityId = created.json().identity.id as string;
    const enrollment = app.inject({
      method: "POST",
      url: `/voice-identities/${identityId}/reference-audio`,
      headers: auth("token-a"),
      payload: { audioBase64: wavFixture().toString("base64") },
    });
    await vi.waitFor(() => expect(provider.enroll).toHaveBeenCalledOnce());
    await app.inject({
      method: "POST",
      url: `/voice-identities/${identityId}/revoke`,
      headers: auth("token-a"),
    });
    finishEnrollment("late-embedding");
    const response = await enrollment;
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("voice_identity_revoked");
    expect(provider.remove).toHaveBeenCalledWith("late-embedding");
    expect(getStoreSnapshot().voiceIdentities[0].status).toBe("revoked");
  });

  it("keeps a hidden deletion reference and retries after provider recovery", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/voice-identities",
      headers: auth("token-a"),
      payload: {
        displayName: "待删除声音",
        consentAccepted: true,
        consentVersion: "voice-identity-v1",
      },
    });
    const identityId = created.json().identity.id as string;
    await app.inject({
      method: "POST",
      url: `/voice-identities/${identityId}/reference-audio`,
      headers: auth("token-a"),
      payload: { audioBase64: wavFixture().toString("base64") },
    });
    provider.remove.mockRejectedValueOnce(new Error("speaker service offline"));

    const revoked = await app.inject({
      method: "POST",
      url: `/voice-identities/${identityId}/revoke`,
      headers: auth("token-a"),
    });
    const pendingRef = getStoreSnapshot().voiceIdentities[0].embeddingRef;
    provider.remove.mockResolvedValue(undefined);
    const recovery = await recoverPendingVoiceIdentityDeletions();
    await app.close();

    expect(revoked.statusCode).toBe(503);
    expect(revoked.json()).not.toHaveProperty("identity.embeddingRef");
    expect(pendingRef).toBe("embedding-a");
    expect(getStoreSnapshot().voiceIdentities[0]).toMatchObject({
      id: identityId,
      status: "revoked",
    });
    expect(getStoreSnapshot().voiceIdentities[0].embeddingRef).toBeUndefined();
    expect(recovery).toEqual({ inspectedCount: 1, deletedCount: 1 });
    expect(provider.remove).toHaveBeenCalledTimes(2);
  });
});

function matchRequest(
  app: Awaited<ReturnType<typeof buildApp>>,
  audio: Buffer,
  secret: string | undefined,
) {
  return app.inject({
    method: "POST",
    url: "/internal/voice-identities/match",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    payload: { userId: "user-a", audioBase64: audio.toString("base64") },
  });
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function account(id: string) {
  const now = "2026-07-14T00:00:00.000Z";
  return {
    id,
    phoneHash: `phone-${id}`,
    phoneMasked: "138****0000",
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
}

function session(token: string, userId: string) {
  return {
    token,
    userId,
    createdAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

function wavFixture() {
  const sampleRate = 16000;
  const samples = sampleRate * 5;
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(5000 * Math.sin(2 * Math.PI * 220 * index / sampleRate));
    wav.writeInt16LE(value, 44 + index * 2);
  }
  return wav;
}
