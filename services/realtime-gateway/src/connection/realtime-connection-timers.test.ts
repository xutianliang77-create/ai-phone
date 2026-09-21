import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { createSession, deleteSession } from "../sessions/session-manager.js";
import { claims } from "./realtime-session-finalizer.test-support.js";
import { startRealtimeConnectionTimers } from "./realtime-connection-timers.js";

const stops: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  deleteSession("finalizer-test");
  vi.useRealTimers();
});

function setup(confirmed = true, previous = Promise.resolve()) {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1, ping: vi.fn(), terminate: vi.fn(),
  });
  const session = createSession(claims());
  const record = vi.fn(async () => {}), touch = vi.fn(async () => {});
  const confirmAudio = vi.fn(async () => {});
  const getBalance = vi.fn(async () => ({ remainingSeconds: 300 }));
  const sendRealtime = vi.fn(), failPublicConnection = vi.fn();
  const endRealtimeSession = vi.fn(async () => {});
  let queue = previous;
  const stop = startRealtimeConnectionTimers({
    ws: socket as unknown as WebSocket, session,
    sessionEventSink: { record, touch, ...(confirmed ? { requiresConfirmation: true as const } : {}) },
    usageBalanceClient: { getBalance }, heartbeatIntervalMs: 120_000,
    confirmAudio, failPublicConnection, sendRealtime, endRealtimeSession,
    enqueueUsage: chain => { queue = chain(queue); },
  });
  stops.push(stop);
  return { socket, session, touch, confirmAudio, getBalance, sendRealtime,
    failPublicConnection, endRealtimeSession, stop, drain: () => queue };
}

describe("connection timer extraction", () => {
  it("serializes balance work behind existing control work and avoids overlapping ticks", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const t = setup(true, pending);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.getBalance).not.toHaveBeenCalled();
    release(); await t.drain();
    expect(t.getBalance).toHaveBeenCalledOnce();
    expect(t.sendRealtime).toHaveBeenCalledWith(expect.objectContaining({ type: "usage.tick", billableSeconds: 30 }));
    await vi.advanceTimersByTimeAsync(30_000); await t.drain();
    expect(t.getBalance).toHaveBeenCalledTimes(2);
  });

  it("ends only on the Wujie account quota decision", async () => {
    const t = setup();
    t.getBalance.mockResolvedValue({ remainingSeconds: 10 });
    await vi.advanceTimersByTimeAsync(30_000); await t.drain();
    expect(t.endRealtimeSession).toHaveBeenCalledWith("quota_exhausted", 0);
    expect(t.session.billableSeconds).toBe(10);
  });

  it("keeps paused persistence alive without a new usage tick", async () => {
    const t = setup(); t.session.status = "paused";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.touch).toHaveBeenCalledWith(t.session.id, "paused");
    expect(t.confirmAudio).toHaveBeenCalled();
    expect(t.getBalance).not.toHaveBeenCalled();
  });

  it("does not touch or confirm a closed public socket", async () => {
    const t = setup(); t.socket.readyState = 3;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.confirmAudio).not.toHaveBeenCalled();
    expect(t.touch).not.toHaveBeenCalled();
    expect(t.getBalance).not.toHaveBeenCalled();
  });

  it("propagates a persistence confirmation failure through the original fail-closed callback", async () => {
    const t = setup(); t.confirmAudio.mockRejectedValueOnce(Error("confirmation_failed"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.failPublicConnection).toHaveBeenCalledOnce();
  });

  it("retains ping/pong liveness and cancels every timer during cleanup", async () => {
    const t = setup(false); t.session.status = "paused";
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.socket.ping).toHaveBeenCalledOnce();
    t.socket.emit("pong");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.socket.ping).toHaveBeenCalledTimes(2);
    expect(t.socket.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.socket.terminate).toHaveBeenCalledOnce();
    t.stop(); const touches = t.touch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.touch).toHaveBeenCalledTimes(touches);
    expect(t.socket.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
