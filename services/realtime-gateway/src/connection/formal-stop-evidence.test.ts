import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeTokenClaims, ServerRealtimeEvent } from "@translation/contracts";
import { verifyGatewayStopReceipt } from "@translation/platform-security";
import { HttpAsrClient } from "../asr/http-asr-client.js";
import { HttpAsrProvider } from "../asr/http-asr-provider.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { attachSession, confirmSessionConnection, createSession, deleteSession, getSession, sessionBillableSeconds, transitionStatus } from "../sessions/session-manager.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";

const key = "fixture-only-formal-gateway-signing-secret";
const claims: RealtimeTokenClaims = { userId: "fixture-owner", sessionId: "formal-stop-test", sourceLanguage: "zh", targetLanguage: "en", voiceOutput: false,
  planCode: "free", maxDurationSeconds: 300, issuedAt: 1, expiresAt: 2 };

describe("formal close evidence and runtime state", () => {
  beforeEach(() => { vi.stubEnv("DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL", "app_store"); });
  afterEach(() => {
    const session = getSession(claims.sessionId);
    if (session) { session.providerCloseConfirmed = true; deleteSession(session.id); }
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  });

  it("does not bill model preparation or permit a second simultaneous attachment", () => {
    const session = createSession(claims);
    expect(session.status).toBe("connecting");
    expect(sessionBillableSeconds(session, () => Date.now() + 84000)).toBe(0);
    expect(attachSession(claims)).toBeNull();
    expect(confirmSessionConnection(session.id, 1)).toBe(true);
    session.activeStartedAt = 1000;
    transitionStatus(session.id, "ending", () => 13000);
    expect(sessionBillableSeconds(session)).toBe(12);
  });

  it("retains an unknown slot and emits no ended receipt after provider close failure", async () => {
    const session = createSession(claims);
    confirmSessionConnection(session.id, 1);
    const close = vi.fn(async () => { throw new Error("close unconfirmed"); });
    const events: ServerRealtimeEvent[] = [];
    const finalizer = makeFinalizer(close, events);
    await finalizer.finalize("client_request");
    expect(session.status).toBe("ending");
    expect(events.some((e) => e.type === "session.ended")).toBe(false);
    expect(deleteSession(session.id)).toBe(false);
    expect(attachSession(claims)).toBeNull();
    close.mockResolvedValue(undefined);
    await finalizer.finalize("client_request");
    const ended = events.find((e) => e.type === "session.ended");
    expect(ended?.type).toBe("session.ended");
    if (ended?.type !== "session.ended") throw new Error("missing stop receipt");
    expect(verifyGatewayStopReceipt(ended.gatewayReceipt, key, { sessionId: session.id, userId: session.userId }))
      .toMatchObject({ providerClosed: true, billableSeconds: ended.billableSeconds });
  });

  it("does not create duplicate end events or restart a closed token", async () => {
    const session = createSession({ ...claims, sessionId: "formal-closed-replay", expiresAt: Math.ceil(Date.now() / 1000) + 300 });
    const events: ServerRealtimeEvent[] = [];
    const close = vi.fn(async () => undefined);
    const finalizer = makeFinalizer(close, events, session.id);
    await Promise.all([finalizer.finalize("client_request"), finalizer.finalize("connection_closed")]);
    expect(events.filter((e) => e.type === "session.ended")).toHaveLength(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(deleteSession(session.id)).toBe(true);
    expect(attachSession(session.claims)).toBeNull();
  });

  it("propagates HTTP ASR close failure in formal mode, retaining legacy best effort", async () => {
    vi.spyOn(HttpAsrClient.prototype, "closeSession").mockRejectedValue(new Error("synthetic close failure"));
    const provider = new HttpAsrProvider({ endpoint: "http://fixture.invalid/asr", timeoutMs: 10 });
    await expect(provider.closeSession("fixture")).rejects.toThrow("synthetic close failure");
    vi.stubEnv("DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL", "restricted_instance");
    await expect(provider.closeSession("fixture")).resolves.toBeUndefined();
  });
});

function makeFinalizer(close: () => Promise<void>, events: ServerRealtimeEvent[], sessionId = claims.sessionId) {
  const provider: RealtimeProvider = { name: "fixture", createSession: async () => undefined,
    sendAudio: async function* () {}, closeSession: close, healthCheck: async () => true };
  return new RealtimeSessionFinalizer({ sessionId, provider,
    audioBatcher: { stopAccepting: () => undefined, flush: async () => undefined },
    send: (e) => events.push(e), drainSessionSync: async () => undefined,
    flushTracker: new RealtimeFlushTracker(), onError: () => undefined, stopReceiptSecret: key });
}
