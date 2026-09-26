import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import * as roomWorker from "./call-room-worker.js";
import { setCallLinkWorkerSupervisorForTests } from "./call-link-worker-supervisor.js";
import { captureEnv, clearEnv, restoreEnv, resetStore } from "./call-room-entry.routes.test-support.js";

describe("Call Link stop recovery after committed settlement", () => {
  let previous: Record<string, string | undefined>;
  const stop = vi.fn<(callId: string) => Promise<void>>();

  beforeEach(() => {
    previous = captureEnv();
    clearEnv();
    for (const key of ["PUBLIC_RUNTIME_ENABLED", "CALL_LINK_PUBLIC_TTS_ENABLED",
      "CALL_LINK_1_0_COMPATIBILITY_ENABLED", "CALL_LINK_DEPLOYMENT_TEST_MODE"]) {
      vi.stubEnv(key, "false");
    }
    resetStore();
    getStoreSnapshot().outboxEvents = [];
    stop.mockReset().mockResolvedValue(undefined);
    setCallLinkWorkerSupervisorForTests({
      async ensure() {}, markReady() {}, stop, shutdown() {},
    });
  });

  afterEach(() => {
    setCallLinkWorkerSupervisorForTests(null);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    restoreEnv(previous);
  });

  it("retries a failed stop on an already ended session without another debit", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({ method: "POST", url: "/call-links" });
      const callId = created.json().callId as string;
      ageSession(callId);
      stop.mockRejectedValueOnce(new Error("synthetic_worker_stop_failed"));
      const first = await app.inject({ method: "POST", url: `/call-links/${callId}/end` });
      const retry = await app.inject({ method: "POST", url: `/call-links/${callId}/end` });
      const ledger = getStoreSnapshot().billingLedger.filter(entry => entry.sessionId === callId);
      expect(first.statusCode).toBe(500);
      expect(retry.statusCode).toBe(200);
      expect(retry.json().status).toBe("ended");
      expect(stop).toHaveBeenCalledTimes(2);
      expect(stop.mock.calls).toEqual([[callId], [callId]]);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.deltaSeconds).toBe(-retry.json().consumedSeconds);
    } finally { await app.close(); }
  });

  it("stops the Worker before attempting a failing end notification", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({ method: "POST", url: "/call-links" });
      const callId = created.json().callId as string;
      ageSession(callId);
      const order: string[] = [];
      stop.mockImplementation(async () => { order.push("stop"); });
      vi.spyOn(roomWorker, "deliverPendingCallRoomDataEvents")
        .mockImplementationOnce(async () => {
          order.push("notify");
          throw new Error("synthetic_notification_failed");
        });
      const response = await app.inject({ method: "POST", url: `/call-links/${callId}/end` });
      expect(response.statusCode).toBe(500);
      expect(order).toEqual(["stop", "notify"]);
      expect(getStoreSnapshot().sessions.find(session => session.id === callId)?.status).toBe("ended");
      expect(getStoreSnapshot().billingLedger.filter(entry => entry.sessionId === callId)).toHaveLength(1);
    } finally { await app.close(); }
  });
});

function ageSession(callId: string) {
  const session = getStoreSnapshot().sessions.find(item => item.id === callId);
  if (!session) throw new Error("synthetic_session_missing");
  session.createdAt = new Date(Date.now() - 8000).toISOString();
}
