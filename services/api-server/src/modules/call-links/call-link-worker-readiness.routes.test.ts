import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";
import {
  setCallLinkWorkerSupervisorForTests,
  type CallLinkWorkerRuntime,
} from "./call-link-worker-supervisor.js";

describe("Call Link Worker readiness events", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    setCallLinkWorkerSupervisorForTests(null);
    restoreEnv(previousEnv);
  });

  it("marks the Worker ready after its joined event is published", async () => {
    const supervisor = new RecordingWorkerRuntime();
    setCallLinkWorkerSupervisorForTests(supervisor);
    setCallRoomDataPublisherForTests({ async publish() {} });
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/events`,
      headers: { authorization: "Bearer internal-secret-123" },
      payload: { events: [workerStartedEvent()] },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(supervisor.readyCallIds).toEqual([callId]);
  });
});

class RecordingWorkerRuntime implements CallLinkWorkerRuntime {
  readonly readyCallIds: string[] = [];
  async ensure() {}
  markReady(callId: string) {
    this.readyCallIds.push(callId);
  }
  stop() {}
  shutdown() {}
}

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "INTERNAL_API_SECRET",
];

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
}

function workerStartedEvent() {
  return {
    type: "worker.status",
    segmentId: "worker-started",
    speakerRole: "worker",
    sourceLanguage: "en",
    targetLanguage: "zh",
    text: "通话翻译 Worker 已启动",
    stage: "worker",
    retryable: false,
    timestampMs: 1,
  };
}
