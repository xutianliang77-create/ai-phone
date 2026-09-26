import { beforeEach, expect, it, vi } from "vitest";
import type { ServerRealtimeEvent } from "@translation/contracts";
import { createSession, deleteSession } from "../sessions/session-manager.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";
import { providerWithFlush, claims } from "./realtime-session-finalizer.test-support.js";

beforeEach(() => deleteSession("finalizer-test"));

it("does not turn an optional diagnostic failure into an unconfirmed public stop", async () => {
  const session = createSession(claims());
  const events: ServerRealtimeEvent[] = [];
  const flushTracker = new RealtimeFlushTracker();
  const failure = new Error("optional diagnostic snapshot unavailable");
  const provider = providerWithFlush();
  provider.diagnostics = vi.fn(async () => { throw failure; });
  provider.closeSession = vi.fn(async () => undefined);
  const drain = vi.fn(async () => undefined);
  const onError = vi.fn();
  const finalizer = new RealtimeSessionFinalizer({sessionId:session.id,provider,
    audioBatcher:{stopAccepting:vi.fn(),flush:vi.fn(async () => undefined)},
    send:event => { flushTracker.record(event); events.push(event); },
    drainSessionSync:drain,flushTracker,onError,
    confirmed:{beforeFlush:vi.fn(async () => undefined)},
  });
  await Promise.all([finalizer.finalize("client_request"),finalizer.finalize("connection_closed")]);
  expect(onError).toHaveBeenCalledWith("provider",failure);
  expect(provider.closeSession).toHaveBeenCalledTimes(1);
  expect(drain).toHaveBeenCalledTimes(2);
  expect(events.filter(event => event.type === "session.ended")).toHaveLength(1);
  expect(events.find(event => event.type === "session.ended")).toMatchObject({
    flush:{status:"completed",transcriptFinalCount:1,translationFinalCount:1},
  });
});
