import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import {
  findWorkerDispatch,
  heartbeatWorkerDispatch,
  releaseWorkerCapacity,
  reserveAndBeginWorkerDispatch,
  updateWorkerDispatch,
} from "./worker-dispatch-runtime.repository.js";

describe("worker dispatch runtime repository", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.workerCapacityReservations = [];
    store.workerDispatches = [];
  });

  it("preserves reserve, dispatch, heartbeat, and release on the legacy driver", async () => {
    const begun = await reserveAndBeginWorkerDispatch(reservation("session_1"));
    expect(begun.status).toBe("created");
    if (!("dispatch" in begun)) throw new Error("Dispatch was not created");

    await updateWorkerDispatch({
      sessionId: "session_1",
      generation: begun.dispatch.generation,
      status: "dispatching",
      resource: "translation_runtime",
    });
    await updateWorkerDispatch({
      sessionId: "session_1",
      generation: begun.dispatch.generation,
      status: "ready",
      resource: "translation_runtime",
    });
    const heartbeatAt = new Date("2026-07-17T10:01:00.000Z");
    await expect(heartbeatWorkerDispatch({
      sessionId: "session_1",
      generation: begun.dispatch.generation,
      workerId: "worker_1",
      jobId: "job_1",
      leaseSeconds: 30,
      resource: "translation_runtime",
      now: heartbeatAt,
    })).resolves.toMatchObject({
      status: "ready",
      workerId: "worker_1",
      jobId: "job_1",
      lastHeartbeatAt: heartbeatAt.toISOString(),
    });
    await expect(findWorkerDispatch("session_1")).resolves.toMatchObject({
      status: "ready",
    });
    await expect(releaseWorkerCapacity(
      "session_1",
      "translation_runtime",
      heartbeatAt,
    )).resolves.toBe(true);
    expect(getStoreSnapshot().workerCapacityReservations[0]?.status).toBe("released");
  });

  it("does not create a dispatch when capacity is exhausted", async () => {
    await reserveAndBeginWorkerDispatch(reservation("session_1"));
    await expect(reserveAndBeginWorkerDispatch(reservation("session_2")))
      .resolves.toMatchObject({ status: "capacity_exhausted", used: 1, limit: 1 });
    await expect(findWorkerDispatch("session_2")).resolves.toBeNull();
  });
});

function reservation(sessionId: string) {
  return {
    callId: sessionId.replace("session", "call"),
    sessionId,
    roomName: sessionId.replace("session", "room"),
    provider: "livekit_dispatch" as const,
    agentName: "translation-worker",
    resource: "translation_runtime" as const,
    owner: "api-test",
    maxUnits: 1,
    leaseSeconds: 30,
    now: new Date("2026-07-17T10:00:00.000Z"),
  };
}
