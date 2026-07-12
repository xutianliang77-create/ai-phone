import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeTokenClaims } from "@translation/contracts";
import { DisconnectFinalizerRegistry } from "../sessions/disconnect-finalizer-registry.js";
import {
  createSession,
  deleteSession,
  getSession,
} from "../sessions/session-manager.js";
import { RealtimeConnectionCleanup } from "./realtime-connection-cleanup.js";

describe("realtime connection cleanup", () => {
  beforeEach(() => deleteSession("cleanup-test"));
  afterEach(() => vi.useRealTimers());

  it("flushes immediately and finalizes once after disconnect grace", async () => {
    vi.useFakeTimers();
    const session = createSession(claims());
    const finalizer = {
      flush: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
    };
    const registry = new DisconnectFinalizerRegistry(30_000, vi.fn());
    const cleanup = new RealtimeConnectionCleanup({
      session,
      generation: session.connectionGeneration,
      finalizer,
      provider: { closeSession: vi.fn(async () => undefined) },
      sessionSync: { drain: vi.fn(async () => undefined) },
      disconnectFinalizers: registry,
      closeClient: vi.fn(),
      onError: vi.fn(),
    });

    await Promise.all([
      cleanup.run("connection_closed"),
      cleanup.run("connection_error"),
    ]);

    expect(session.status).toBe("connecting");
    expect(finalizer.flush).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(finalizer.finalize).toHaveBeenCalledTimes(1);
    expect(finalizer.finalize).toHaveBeenCalledWith("connection_closed");
    expect(getSession(session.id)).toBeNull();
  });

  it("does not finalize a newer connection generation", async () => {
    const session = createSession(claims());
    const finalizer = {
      flush: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
    };
    const registry = new DisconnectFinalizerRegistry(30_000, vi.fn());
    const oldGeneration = session.connectionGeneration;
    session.connectionGeneration += 1;
    const cleanup = new RealtimeConnectionCleanup({
      session,
      generation: oldGeneration,
      finalizer,
      provider: { closeSession: vi.fn(async () => undefined) },
      sessionSync: { drain: vi.fn(async () => undefined) },
      disconnectFinalizers: registry,
      closeClient: vi.fn(),
      onError: vi.fn(),
    });

    await cleanup.run("connection_closed");

    expect(session.status).toBe("active");
    expect(finalizer.flush).toHaveBeenCalledTimes(1);
    expect(finalizer.finalize).not.toHaveBeenCalled();
  });

  it("keeps the original deadline across an unconfirmed reconnect", async () => {
    vi.useFakeTimers();
    const session = createSession(claims());
    const finalizer = {
      flush: vi.fn(async () => undefined),
      finalize: vi.fn(async () => undefined),
    };
    const registry = new DisconnectFinalizerRegistry(30_000, vi.fn());
    const cleanup = new RealtimeConnectionCleanup({
      session,
      generation: session.connectionGeneration,
      finalizer,
      provider: { closeSession: vi.fn(async () => undefined) },
      sessionSync: { drain: vi.fn(async () => undefined) },
      disconnectFinalizers: registry,
      closeClient: vi.fn(),
      onError: vi.fn(),
    });

    await cleanup.run("connection_closed");
    session.connectionGeneration += 1;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(finalizer.finalize).toHaveBeenCalledTimes(1);
    expect(getSession(session.id)).toBeNull();
  });

  it("establishes the disconnect deadline before a slow flush completes", async () => {
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => { releaseFlush = resolve; });
    const session = createSession(claims());
    const registry = new DisconnectFinalizerRegistry(30_000, vi.fn());
    const cleanup = new RealtimeConnectionCleanup({
      session,
      generation: session.connectionGeneration,
      finalizer: {
        flush: vi.fn(() => flushGate),
        finalize: vi.fn(async () => undefined),
      },
      provider: { closeSession: vi.fn(async () => undefined) },
      sessionSync: { drain: vi.fn(async () => undefined) },
      disconnectFinalizers: registry,
      closeClient: vi.fn(),
      onError: vi.fn(),
    });

    const running = cleanup.run("connection_closed");
    await Promise.resolve();

    expect(session.status).toBe("connecting");
    expect(session.disconnectDeadlineAt).toBeTypeOf("number");
    expect(registry.deadline(session.id)).toBe(session.disconnectDeadlineAt);
    releaseFlush();
    await running;
    registry.close();
  });
});

function claims(): RealtimeTokenClaims {
  return {
    userId: "guest-user",
    sessionId: "cleanup-test",
    sourceLanguage: "en",
    targetLanguage: "zh",
    voiceOutput: false,
    planCode: "free",
    maxDurationSeconds: 300,
    issuedAt: 1,
    expiresAt: 9999999999,
  };
}
