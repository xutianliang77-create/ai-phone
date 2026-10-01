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

function setup(confirmed = true, previous = Promise.resolve(), qaWallSeconds?:number,ordinaryPublic=false,recoveredHold?:number) {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1, ping: vi.fn(), terminate: vi.fn(),
  });
  const token=claims();
  if(qaWallSeconds!==undefined||ordinaryPublic){
    token.issuedAt=Math.floor(Date.now()/1000);
    token.holdSeconds=30;
    if(qaWallSeconds!==undefined){
      token.maxDurationSeconds=qaWallSeconds;
      token.qaOneShot={authorizationId:"qa-timer-test",hardDeadlineAt:token.issuedAt+qaWallSeconds};
    }else delete token.maxDurationSeconds;
    token.publicRuntime={deploymentId:"public-qa",leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationRevision:1,configurationHash:"a".repeat(64)};
  }
  const session = createSession(token);
  if(recoveredHold!==undefined){session.publicAuthorizedSeconds=recoveredHold;session.accumulatedActiveMs=60_000;}
  const record = vi.fn(async () => {}), touch = vi.fn(async () => {});
  const confirmAudio = vi.fn(async () => {});
  const getBalance = vi.fn(async () => ({ remainingSeconds: 300 }));
  const reserveAllowance=vi.fn(async(_sessionId:string,target:number)=>({
    remainingSeconds:300,availableSeconds:Math.max(0,300-target),authorizedSeconds:target,
  }));
  const sendRealtime = vi.fn(), failPublicConnection = vi.fn(), forceQaSupplierStop=vi.fn(async()=>{});
  const endRealtimeSession = vi.fn(async () => {});
  let queue = previous;
  const stop = startRealtimeConnectionTimers({
    ws: socket as unknown as WebSocket, session,
    sessionEventSink: { record, touch, ...(confirmed ? { requiresConfirmation: true as const } : {}) },
    usageBalanceClient: { getBalance,reserveAllowance }, heartbeatIntervalMs: 120_000,
    confirmAudio, failPublicConnection, forceQaSupplierStop, sendRealtime, endRealtimeSession,
    enqueueUsage: chain => { queue = chain(queue); },
  });
  stops.push(stop);
  return { socket, session, touch, confirmAudio, getBalance,reserveAllowance,sendRealtime,
    failPublicConnection, forceQaSupplierStop, endRealtimeSession, stop, drain: () => queue };
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

  it("cuts off a signed public QA session at its wall deadline even while paused",async()=>{
    const t=setup(true,Promise.resolve(),40);t.session.status="paused";
    const remaining=t.session.claims.qaOneShot!.hardDeadlineAt*1000-Date.now();
    await vi.advanceTimersByTimeAsync(remaining-1);
    expect(t.endRealtimeSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.endRealtimeSession).toHaveBeenCalledWith("time_limit",0);
    t.session.status="ended";
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.socket.terminate).not.toHaveBeenCalled();
  });
  it("terminates the QA socket if finalization hangs past the safety reserve",async()=>{
    const t=setup(true,Promise.resolve(),40);
    t.endRealtimeSession.mockImplementation(()=>new Promise<void>(()=>{}));
    const remaining=t.session.claims.qaOneShot!.hardDeadlineAt*1000-Date.now();
    await vi.advanceTimersByTimeAsync(remaining+5_000);
    expect(t.endRealtimeSession).toHaveBeenCalledWith("time_limit",0);
    expect(t.failPublicConnection).toHaveBeenCalledOnce();
    expect(t.forceQaSupplierStop).toHaveBeenCalledOnce();
    expect(t.socket.terminate).toHaveBeenCalledOnce();
  });
  it("closes the QA supplier immediately when deadline finalization rejects",async()=>{
    const t=setup(true,Promise.resolve(),40);
    t.endRealtimeSession.mockRejectedValueOnce(Error("synthetic_finalization_failure"));
    const remaining=t.session.claims.qaOneShot!.hardDeadlineAt*1000-Date.now();
    await vi.advanceTimersByTimeAsync(remaining);
    expect(t.forceQaSupplierStop).toHaveBeenCalledOnce();
    expect(t.failPublicConnection).toHaveBeenCalledOnce();
    expect(t.socket.terminate).toHaveBeenCalledOnce();
  });
  it("does not impose the QA wall timer on an ordinary public connection",async()=>{
    const t=setup(true);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(t.endRealtimeSession).not.toHaveBeenCalled();
  });
  it("renews the same public account allowance and reports measured active time",async()=>{
    const t=setup(true,Promise.resolve(),undefined,true);
    await vi.advanceTimersByTimeAsync(30_000);await t.drain();
    expect(t.reserveAllowance.mock.calls.map(call=>call[1])).toEqual([40,50,60]);
    expect(t.getBalance).not.toHaveBeenCalled();
    expect(t.sendRealtime).toHaveBeenCalledWith(expect.objectContaining({
      type:"usage.tick",billableSeconds:30,remainingSeconds:270,
    }));
    expect(t.sendRealtime.mock.calls[0][0]).not.toHaveProperty('lowBalance');
    expect(t.endRealtimeSession).not.toHaveBeenCalled();
  });
  it("ends a public session at its held quota and fails closed if allowance cannot be read",async()=>{
    const quota=setup(true,Promise.resolve(),undefined,true);
    quota.reserveAllowance.mockImplementation(async()=>({remainingSeconds:30,availableSeconds:0,authorizedSeconds:30}));
    await vi.advanceTimersByTimeAsync(30_000);await quota.drain();
    expect(quota.endRealtimeSession).toHaveBeenCalledWith("quota_exhausted",0);
    quota.stop();
    const unknown=setup(true,Promise.resolve(),undefined,true);
    unknown.reserveAllowance.mockResolvedValue(null as never);
    await vi.advanceTimersByTimeAsync(10_000);await unknown.drain();
    expect(unknown.endRealtimeSession).toHaveBeenCalledWith("connection_error",0);
    expect(unknown.sendRealtime).not.toHaveBeenCalled();
  });
  it('keeps the current confirmed hold on paused recovery instead of resetting to the original 30 seconds',async()=>{
    const t=setup(true,Promise.resolve(),undefined,true,90);
    await vi.advanceTimersByTimeAsync(10_000);await t.drain();
    expect(t.reserveAllowance).toHaveBeenCalledWith(t.session.id,100);
    expect(t.session.publicAuthorizedSeconds).toBe(100);
    expect(t.endRealtimeSession).not.toHaveBeenCalled();
    t.reserveAllowance.mockResolvedValue(null as never);
    await vi.advanceTimersByTimeAsync(10_000);await t.drain();
    expect(t.endRealtimeSession).toHaveBeenCalledWith('connection_error',0);
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
