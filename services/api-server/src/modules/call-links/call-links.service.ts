import { randomUUID } from "node:crypto";
import { createSession } from "../sessions/sessions.repository.js";
import { createUsageHold } from "../usage/usage.service.js";
import { callRoomName } from "./call-room-token.js";

export interface CallLinkRecord {
  callId: string;
  userId: string;
  sessionId: string;
  roomName: string;
  roomProvider: "livekit";
  joinUrl: string;
  hostUrl: string;
  status: "created" | "ended";
  mode: "call_link";
  expiresAt: string;
  createdAt: string;
  endedAt?: string;
}

const callLinks = new Map<string, CallLinkRecord>();
const callLinkStartHoldSeconds = 60;

export function createCallLink(options: {
  userId: string;
  publicBaseUrl: string;
  ttlMinutes?: number;
  now?: Date;
}): CallLinkRecord | null {
  const now = options.now ?? new Date();
  const callId = randomUUID();
  const hold = createUsageHold(options.userId, callLinkStartHoldSeconds, undefined, {
    sessionId: callId,
    idempotencyKey: `hold:${callId}`,
    note: "call_link_session_hold",
    ttlSeconds: (options.ttlMinutes ?? 60) * 60,
  });
  if (hold.status !== "held") return null;
  const expiresAt = new Date(
    now.getTime() + (options.ttlMinutes ?? 60) * 60 * 1000,
  );
  const baseUrl = normalizeBaseUrl(options.publicBaseUrl);
  const roomName = callRoomName(callId);
  const record: CallLinkRecord = {
    callId,
    userId: options.userId,
    sessionId: callId,
    roomName,
    roomProvider: "livekit",
    joinUrl: `${baseUrl}/join/${callId}`,
    hostUrl: `${baseUrl}/host/${callId}`,
    status: "created",
    mode: "call_link",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  callLinks.set(callId, record);
  createSession({
    id: record.sessionId,
    userId: options.userId,
    mode: "call_link",
    status: "created",
    consumedSeconds: 0,
    createdAt: record.createdAt,
    segments: [],
  });
  return record;
}

export function findCallLink(callId: string): CallLinkRecord | null {
  return callLinks.get(callId) ?? null;
}

export function markCallLinkEnded(callId: string, endedAt?: string) {
  const record = findCallLink(callId);
  if (!record) return null;
  record.status = "ended";
  if (endedAt) record.endedAt = endedAt;
  return record;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}
