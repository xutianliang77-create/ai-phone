import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import type { CallLinkRecord } from "./call-links.service.js";
import { buildCallRoomSmokeEvents } from "./call-room-events.js";
import {
  isLiveKitAlreadyExistsError,
  publishCallRoomDataEvents,
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";

describe("call room worker publisher", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureCallRoomEnv();
    resetStore();
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    restoreEnv(previousEnv);
  });

  it("ensures the LiveKit room before publishing data events", async () => {
    const calls: string[] = [];
    const record = fakeCallLinkRecord("call_1");
    const [event] = buildCallRoomSmokeEvents({
      callId: record.callId,
      roomName: record.roomName,
    });

    setCallRoomDataPublisherForTests({
      async ensureRoom(roomName) {
        calls.push(`ensure:${roomName}`);
      },
      async publish(roomName, publishedEvent) {
        calls.push(`publish:${roomName}:${publishedEvent.type}`);
      },
    } satisfies CallRoomDataPublisher);

    const result = await publishCallRoomDataEvents(record, [event]);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "ensure:call_call_1",
      "publish:call_call_1:worker.status",
    ]);
  });

  it("recognizes LiveKit room already-exists errors as idempotent", () => {
    expect(isLiveKitAlreadyExistsError({ code: "already_exists" })).toBe(true);
    expect(isLiveKitAlreadyExistsError({ status: 409 })).toBe(true);
    expect(
      isLiveKitAlreadyExistsError({ message: "room already exists" }),
    ).toBe(true);
    expect(isLiveKitAlreadyExistsError({ message: "network failed" })).toBe(
      false,
    );
  });
});

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
];

function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "3600";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = {};
  store.usagePlanCodes = {};
  store.usageHolds = [];
  store.entitlementPlanCodes = {};
  store.entitlementOrderIds = {};
  store.paymentOrders = [];
  store.billingLedger = [];
  store.appleServerNotifications = [];
  store.appErrorReports = [];
}

function fakeCallLinkRecord(callId: string): CallLinkRecord {
  const now = new Date("2026-07-05T00:00:00.000Z").toISOString();
  return {
    callId,
    sessionId: callId,
    roomName: `call_${callId}`,
    roomProvider: "livekit",
    joinUrl: `https://call.example.cn/join/${callId}`,
    hostUrl: `https://call.example.cn/host/${callId}`,
    status: "created",
    mode: "call_link",
    createdAt: now,
    expiresAt: now,
  };
}
