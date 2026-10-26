import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../config/env.js";
import { ProviderRouter } from "../providers/provider-router.js";
import { createSession, deleteSession, getSession } from "../sessions/session-manager.js";
import { startWebSocketServer } from "./websocket-server.js";

const injected = vi.hoisted(() => ({ runtime: {} as Record<string, unknown>, attachment: {} }));
vi.mock("./realtime-server-runtime.js", () => ({
  createRealtimeServerRuntime: () => injected.runtime,
  listenRealtimeServerRuntime: () => injected.runtime,
}));
vi.mock("./realtime-connection-admission.js", async (original) => ({
  ...await original<typeof import("./realtime-connection-admission.js")>(),
  admitRealtimeConnection: () => injected.attachment,
}));

describe("formal connection handler with an injected local runtime", () => {
  let id: string;
  let server: EventEmitter;
  let socket: EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let touch: ReturnType<typeof vi.fn>;
  let record: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL", "app_store");
    vi.stubEnv("REALTIME_TOKEN_SECRET", "fixture-only-formal-gateway-signing-secret");
    id = `startup-${crypto.randomUUID()}`;
    const session = createSession({ userId: "fixture-owner", sessionId: id, sourceLanguage: "zh", targetLanguage: "en",
      voiceOutput: false, planCode: "free", maxDurationSeconds: 300, issuedAt: 1, expiresAt: 2 });
    injected.attachment = { session, generation: 1, resumed: false };
    server = new EventEmitter();
    socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), close: vi.fn() });
    touch = vi.fn(async () => undefined); record = vi.fn(async () => undefined);
    injected.runtime = { env: loadEnv(), server, sessionEventSink: { touch, record },
      dependencyReadiness: { readiness: () => ({ sessionReady: true, services: [] }) } };
  });
  afterEach(() => {
    const session = getSession(id);
    if (session) { session.providerCloseConfirmed = true; deleteSession(id); }
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });
  it("does not dispatch or invent zero settlement when admission response is lost", async () => {
    touch.mockRejectedValue(new Error("synthetic admission timeout"));
    const select = vi.spyOn(ProviderRouter.prototype, "selectProvider");
    startWebSocketServer(); server.emit("connection", socket, {});
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalled());
    expect(touch).toHaveBeenCalledWith(id, "active", { fresh: true });
    expect(select).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(getSession(id)).toMatchObject({ status: "failed", providerCloseConfirmed: false });
  });
  it.each([true, false])("issues a failure stop proof only if provider close is confirmed=%s", async (confirmed) => {
    const close = vi.fn(async () => { if (!confirmed) throw new Error("synthetic close timeout"); });
    vi.spyOn(ProviderRouter.prototype, "selectProvider").mockReturnValue({ name: "fixture", createSession: async () => { throw new Error("synthetic startup failure"); },
      closeSession: close, sendAudio: async function* () {}, healthCheck: async () => true });
    startWebSocketServer(); server.emit("connection", socket, {});
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalled());
    expect(close).toHaveBeenCalledTimes(1);
    if (confirmed) {
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: "session.ended", billableSeconds: 0, gatewayReceipt: expect.stringMatching(/^wj10stop\./) }));
      expect(getSession(id)).toBeNull();
    } else {
      expect(record).not.toHaveBeenCalled();
      expect(getSession(id)?.providerCloseConfirmed).toBe(false);
    }
  });
});
