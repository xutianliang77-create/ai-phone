import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeTokenClaims,
  ServerRealtimeEvent,
} from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import {
  createSession,
  deleteSession,
  getSession,
} from "../sessions/session-manager.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";

describe("realtime session finalizer", () => {
  beforeEach(() => deleteSession("finalizer-test"));

  it("flushes and settles concurrent finalization only once", async () => {
    const session = createSession(claims());
    session.activeStartedAt = Date.now() - 8_000;
    const events: ServerRealtimeEvent[] = [];
    const audioBatcher = {
      stopAccepting: vi.fn(),
      flush: vi.fn(async () => undefined),
      diagnostics: vi.fn(() => ({
        receivedFrameCount: 10,
        processedBatchCount: 2,
        droppedFrameCount: 1,
      })),
    };
    const provider = providerWithFlush();
    const flushTracker = new RealtimeFlushTracker();
    const drainSessionSync = vi.fn(async () => undefined);
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider,
      audioBatcher,
      send: (event) => {
        flushTracker.record(event);
        events.push(event);
      },
      drainSessionSync,
      flushTracker,
      onError: vi.fn(),
    });

    await Promise.all([
      finalizer.finalize("connection_closed"),
      finalizer.finalize("client_request"),
    ]);

    expect(audioBatcher.stopAccepting).toHaveBeenCalledTimes(1);
    expect(audioBatcher.flush).toHaveBeenCalledTimes(1);
    const ended = events.filter((event) => event.type === "session.ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ reason: "connection_closed" });
    expect(ended[0]).toMatchObject({
      flush: {
        status: "completed",
        transcriptFinalCount: 1,
        translationFinalCount: 1,
        unresolvedSegmentCount: 0,
      },
    });
    expect(ended[0].billableSeconds).toBeGreaterThanOrEqual(8);
    expect(ended[0]).toMatchObject({
      diagnostics: {
        version: 1,
        audio: {
          receivedFrameCount: 10,
          processedBatchCount: 2,
          droppedFrameCount: 1,
        },
      },
    });
    expect(getSession(session.id)?.status).toBe("ended");
    expect(drainSessionSync).toHaveBeenCalledTimes(2);
  });

  it("still ends the session when pipeline flush fails", async () => {
    const session = createSession(claims());
    const errors: string[] = [];
    const events: ServerRealtimeEvent[] = [];
    const flushTracker = new RealtimeFlushTracker();
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider: providerWithFlush(true),
      audioBatcher: {
        stopAccepting: vi.fn(),
        flush: vi.fn(async () => { throw new Error("audio flush failed"); }),
      },
      send: (event) => {
        flushTracker.record(event);
        events.push(event);
      },
      drainSessionSync: async () => undefined,
      flushTracker,
      onError: (stage) => errors.push(stage),
    });

    await finalizer.finalize("connection_error");

    expect(errors).toEqual(["audio", "provider"]);
    expect(events.some((event) => event.type === "session.ended")).toBe(true);
    expect(events.find((event) => event.type === "session.ended")).toMatchObject({
      flush: {
        status: "degraded",
        audioFlushed: false,
        providerFlushed: false,
      },
    });
    expect(getSession(session.id)?.status).toBe("ended");
  });

  it("ends a confirmed public session once when a flushed segment has translation.failed", async () => {
    const session = createSession(claims());
    const events: ServerRealtimeEvent[] = [];
    const close = vi.fn(async () => undefined);
    const flushTracker = new RealtimeFlushTracker();
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider: {
        ...providerWithoutTail(),
        closeSession: close,
        flushSession: async function* () {
          yield {
            type: "transcript.final" as const,
            sessionId: session.id,
            segmentId: "failed-tail",
            text: "source text",
            language: "en" as const,
          };
          yield {
            type: "translation.failed" as const,
            sessionId: session.id,
            segmentId: "failed-tail",
            message: "Translation unavailable",
            language: "zh" as const,
            stage: "translation" as const,
          };
        },
      },
      audioBatcher: { stopAccepting: vi.fn(), flush: vi.fn(async () => undefined) },
      send: (event) => { flushTracker.record(event); events.push(event); },
      drainSessionSync: vi.fn(async () => undefined),
      flushTracker,
      onError: vi.fn(),
      confirmed: { beforeFlush: vi.fn(async () => undefined) },
    });

    await Promise.all([
      finalizer.finalize("client_request"),
      finalizer.finalize("connection_closed"),
    ]);

    const ended = events.filter((event) => event.type === "session.ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      reason: "client_request",
      flush: {
        status: "degraded",
        translationFailedCount: 1,
        unresolvedSegmentCount: 0,
        audioFlushed: true,
        providerFlushed: true,
      },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(getSession(session.id)?.status).toBe("ended");
  });

  it("does not replay an uncertain confirmed-provider flush after it fails", async () => {
    const session = createSession(claims());
    const flush = vi.fn(async function* () { throw new Error("provider uncertain"); });
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider: { ...providerWithoutTail(), flushSession: flush },
      audioBatcher: { stopAccepting: vi.fn(), flush: vi.fn(async () => undefined) },
      send: () => undefined,
      drainSessionSync: async () => undefined,
      flushTracker: new RealtimeFlushTracker(),
      onError: vi.fn(),
      confirmed: { beforeFlush: async () => undefined },
    });

    await expect(finalizer.finalize("client_request")).rejects.toThrow("public_final_flush_unconfirmed");
    await expect(finalizer.finalize("connection_closed")).rejects.toThrow("public_final_flush_unconfirmed");
    expect(flush).toHaveBeenCalledOnce();
  });

  it("reports an empty successful flush when no tail audio remains", async () => {
    const session = createSession(claims());
    const events: ServerRealtimeEvent[] = [];
    const flushTracker = new RealtimeFlushTracker();
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider: providerWithoutTail(),
      audioBatcher: {
        stopAccepting: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      send: (event) => {
        flushTracker.record(event);
        events.push(event);
      },
      drainSessionSync: async () => undefined,
      flushTracker,
      onError: vi.fn(),
    });

    await finalizer.finalize("client_request");

    expect(events.find((event) => event.type === "session.ended")).toMatchObject({
      flush: {
        status: "empty",
        transcriptFinalCount: 0,
        translationFinalCount: 0,
        audioFlushed: true,
        providerFlushed: true,
      },
    });
  });

  it("marks only finalization drains as supplier-session finish", async () => {
    const session = createSession(claims());
    const options:Array<{finishSession?:boolean}|undefined>=[];
    const provider=providerWithoutTail();
    provider.flushSession=async function*(_sessionId,value){options.push(value);};
    const finalizer=new RealtimeSessionFinalizer({sessionId:session.id,provider,
      audioBatcher:{stopAccepting:vi.fn(),flush:vi.fn(async()=>undefined)},send:()=>{},
      drainSessionSync:async()=>undefined,flushTracker:new RealtimeFlushTracker(),onError:vi.fn()});
    await finalizer.finalize("client_request");
    expect(options).toEqual([{finishSession:true}]);
  });

  it("closes provider capacity before announcing session ended", async () => {
    const session = createSession(claims());
    const order: string[] = [];
    const provider = providerWithoutTail();
    provider.closeSession = async () => { order.push("provider.closed"); };
    const flushTracker = new RealtimeFlushTracker();
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider,
      audioBatcher: {
        stopAccepting: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      send: (event) => {
        if (event.type === "session.ended") order.push("session.ended");
      },
      drainSessionSync: async () => undefined,
      flushTracker,
      onError: vi.fn(),
    });

    await finalizer.finalize("client_request");

    expect(order).toEqual(["provider.closed", "session.ended"]);
  });

  it("keeps the flush-time diagnostic snapshot after provider cleanup", async () => {
    const session = createSession(claims());
    const events: ServerRealtimeEvent[] = [];
    let diagnosticsAvailable = true;
    const provider: RealtimeProvider = {
      ...providerWithoutTail(),
      diagnostics: async () => diagnosticsAvailable
        ? {
          speakerTurns: {
            confirmedBoundaryCount: 1,
            commitHitCount: 1,
            commitMissCount: 0,
            commitErrorCount: 0,
            endpointRaceCount: 0,
            averageConfirmationLatencyMs: 300,
            maxConfirmationLatencyMs: 300,
            committedAudioMs: 900,
            endpointReasons: { speaker_boundary: 1 },
          },
        }
        : {},
    };
    const flushTracker = new RealtimeFlushTracker();
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider,
      audioBatcher: {
        stopAccepting: vi.fn(),
        flush: vi.fn(async () => undefined),
      },
      send: (event) => events.push(event),
      drainSessionSync: async () => undefined,
      flushTracker,
      onError: vi.fn(),
    });

    await finalizer.flush();
    diagnosticsAvailable = false;
    await finalizer.finalize("connection_closed");

    expect(events.find((event) => event.type === "session.ended")).toMatchObject({
      diagnostics: {
        speakerTurns: {
          confirmedBoundaryCount: 1,
          commitHitCount: 1,
        },
      },
    });
  });
});

function providerWithFlush(fail = false): RealtimeProvider {
  return {
    name: "test",
    createSession: async () => undefined,
    sendAudio: async function* () {},
    flushSession: async function* () {
      if (fail) throw new Error("provider flush failed");
      yield {
        type: "transcript.final",
        sessionId: "finalizer-test",
        segmentId: "tail",
        text: "tail audio",
        language: "en",
      } satisfies ServerRealtimeEvent;
      yield {
        type: "translation.final",
        sessionId: "finalizer-test",
        segmentId: "tail",
        text: "尾句",
        language: "zh",
      } satisfies ServerRealtimeEvent;
    },
    closeSession: async () => undefined,
  };
}

function providerWithoutTail(): RealtimeProvider {
  return {
    name: "test",
    createSession: async () => undefined,
    sendAudio: async function* () {},
    flushSession: async function* () {},
    closeSession: async () => undefined,
    healthCheck: async () => true,
  };
}

function claims(): RealtimeTokenClaims {
  return {
    userId: "guest-user",
    sessionId: "finalizer-test",
    sourceLanguage: "en",
    targetLanguage: "zh",
    voiceOutput: false,
    planCode: "free",
    maxDurationSeconds: 300,
    issuedAt: 1,
    expiresAt: 9999999999,
  };
}
