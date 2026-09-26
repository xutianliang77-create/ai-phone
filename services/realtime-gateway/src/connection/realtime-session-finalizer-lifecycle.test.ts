import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEndReason } from "@translation/contracts";
import { createSession, deleteSession } from "../sessions/session-manager.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";
import { claims, providerWithoutTail } from "./realtime-session-finalizer.test-support.js";

describe("public finalization lifecycle metadata", () => {
  beforeEach(() => {
    deleteSession("finalizer-test");
    vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED", "true");
    vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED", "true");
  });
  afterEach(() => { deleteSession("finalizer-test"); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each<SessionEndReason>(["client_request", "connection_closed", "connection_error",
    "time_limit", "quota_exhausted", "inactivity_timeout"])("retains %s through confirmed synchronization", async reason => {
    const info = vi.spyOn(realtimeLogger, "info").mockImplementation(() => {});
    await fixture().finalize(reason);
    expect(lifecycle(info)).toEqual([
      { sessionId: "finalizer-test", reason, stage: "requested" },
      { sessionId: "finalizer-test", reason, stage: "sync_drained" },
    ]);
  });

  it("records the first termination cause only when callers race", async () => {
    const info = vi.spyOn(realtimeLogger, "info").mockImplementation(() => {});
    const finalizer = fixture();
    await Promise.all([finalizer.finalize("client_request"), finalizer.finalize("connection_closed")]);
    expect(lifecycle(info).map(value => value.reason)).toEqual(["client_request", "client_request"]);
  });

  it("does not report a drained stop after an unconfirmed provider flush", async () => {
    const info = vi.spyOn(realtimeLogger, "info").mockImplementation(() => {});
    const finalizer = fixture({ flushFails: true });
    await expect(finalizer.finalize("client_request")).rejects.toThrow("public_final_flush_unconfirmed");
    expect(lifecycle(info).map(value => value.stage)).toEqual(["requested", "flush_unconfirmed"]);
    expect(JSON.stringify(lifecycle(info))).not.toContain("PRIVATE_ERROR");
  });

  it("separates an end synchronization failure from a successful acknowledgement", async () => {
    const info = vi.spyOn(realtimeLogger, "info").mockImplementation(() => {});
    const drain = vi.fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("PRIVATE_ERROR"));
    await expect(fixture({ drain }).finalize("connection_closed")).rejects.toThrow("PRIVATE_ERROR");
    expect(lifecycle(info).map(value => value.stage)).toEqual(["requested", "sync_unconfirmed"]);
    expect(JSON.stringify(lifecycle(info))).not.toContain("PRIVATE_ERROR");
  });

  it("does not trace the inherited private finalizer", async () => {
    const info = vi.spyOn(realtimeLogger, "info").mockImplementation(() => {});
    await fixture({ confirmed: false }).finalize("client_request");
    expect(lifecycle(info)).toEqual([]);
  });
});

function fixture(options: { confirmed?: boolean; flushFails?: boolean; drain?: () => Promise<void> } = {}) {
  const session = createSession(claims());
  const provider = providerWithoutTail();
  if (options.flushFails) provider.flushSession = async function* () { throw new Error("PRIVATE_ERROR"); };
  return new RealtimeSessionFinalizer({
    sessionId: session.id, provider,
    audioBatcher: { stopAccepting() {}, async flush() {} },
    send() {}, drainSessionSync: options.drain ?? (async () => {}),
    flushTracker: new RealtimeFlushTracker(), onError() {},
    ...(options.confirmed === false ? {} : { confirmed: { async beforeFlush() {} } }),
  });
}

function lifecycle(info: { mock: { calls: unknown[][] } }) {
  return info.mock.calls.filter(call => call[1] === "Public session QA finalization")
    .map(call => call[0] as { sessionId: string; reason: SessionEndReason; stage: string });
}
