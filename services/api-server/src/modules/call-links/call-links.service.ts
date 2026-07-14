import { randomUUID } from "node:crypto";
import {
  createSession,
  findSession,
  upsertCallLeg,
} from "../sessions/sessions.repository.js";
import {
  createUsageHold,
} from "../usage/usage.service.js";
import { runStoreTransaction } from "../../infrastructure/storage/json-store.js";
import { callRoomName } from "./call-room-token.js";
import type {
  CallJoinType,
  CallLegRecord,
  CallLinkStatus,
  CallParticipantRole,
} from "./call-link-record.js";

export interface CallLinkRecord {
  callId: string;
  userId: string;
  sessionId: string;
  roomName: string;
  roomProvider: "livekit";
  joinUrl: string;
  hostUrl: string;
  status: CallLinkStatus;
  version: number;
  mode: "call_link";
  expiresAt: string;
  createdAt: string;
  endedAt?: string;
}

const callLinkStartHoldSeconds = 60;

export function createCallLink(options: {
  userId: string;
  publicBaseUrl: string;
  ttlMinutes?: number;
  now?: Date;
}): CallLinkRecord | null {
  return runStoreTransaction(() => createCallLinkTransaction(options));
}

function createCallLinkTransaction(options: {
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
    version: 1,
    mode: "call_link",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  createSession({
    id: record.sessionId,
    userId: options.userId,
    mode: "call_link",
    status: "created",
    consumedSeconds: 0,
    createdAt: record.createdAt,
    segments: [],
    callLegs: [],
    playbacks: [],
    callLink: {
      roomName: record.roomName,
      roomProvider: record.roomProvider,
      joinUrl: record.joinUrl,
      hostUrl: record.hostUrl,
      expiresAt: record.expiresAt,
    },
  });
  return record;
}

export function findCallLink(callId: string): CallLinkRecord | null {
  const session = findSession(callId);
  if (!session || session.mode !== "call_link" || !session.callLink) return null;
  return {
    callId: session.id,
    userId: session.userId,
    sessionId: session.id,
    roomName: session.callLink.roomName,
    roomProvider: session.callLink.roomProvider,
    joinUrl: session.callLink.joinUrl,
    hostUrl: session.callLink.hostUrl,
    status: callLinkStatus(session.status, session.callLegs ?? []),
    version: session.version ?? 1,
    mode: "call_link",
    expiresAt: session.callLink.expiresAt,
    createdAt: session.createdAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
  };
}

export function registerCallLeg(options: {
  callId: string;
  participantIdentity: string;
  participantRole: CallParticipantRole;
  joinType: CallJoinType;
  joinedAt?: string;
}) {
  const record = findCallLink(options.callId);
  if (!record || record.status === "ended") return null;
  return upsertCallLeg(record.sessionId, {
    id: options.participantIdentity,
    participantIdentity: options.participantIdentity,
    participantRole: options.participantRole,
    joinType: options.joinType,
    status: "active",
    joinedAt: options.joinedAt ?? new Date().toISOString(),
  });
}

export function hasActiveHumanCallPair(callId: string) {
  const record = findCallLink(callId);
  if (!record || record.status === "ended") return false;
  const session = findSession(record.sessionId);
  const activeRoles = new Set(
    (session?.callLegs ?? [])
      .filter((leg) => leg.status === "active")
      .map((leg) => leg.participantRole),
  );
  return activeRoles.has("host") && activeRoles.has("guest");
}

export function hasActiveCallWorker(callId: string) {
  const record = findCallLink(callId);
  if (!record || record.status === "ended") return false;
  const session = findSession(record.sessionId);
  return (session?.callLegs ?? []).some(
    (leg) => leg.status === "active" && leg.participantRole === "worker",
  );
}

export function persistedCallRoomHumanPresence(callId: string) {
  const record = findCallLink(callId);
  const session = record ? findSession(record.sessionId) : null;
  const activeLegs = (session?.callLegs ?? []).filter(
    (leg) => leg.status === "active",
  );
  const activeHostCount = activeLegs.filter(
    (leg) => leg.participantRole === "host",
  ).length;
  const activeGuestCount = activeLegs.filter(
    (leg) => leg.participantRole === "guest",
  ).length;
  return {
    activeHostCount,
    activeGuestCount,
    activeHumanParticipantCount: activeHostCount + activeGuestCount,
  };
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function callLinkStatus(
  sessionStatus: string,
  callLegs: CallLegRecord[],
): CallLinkStatus {
  if (sessionStatus === "ended") return "ended";
  const activeRoles = new Set(
    callLegs
      .filter((leg) => leg.status === "active")
      .map((leg) => leg.participantRole),
  );
  return activeRoles.has("host") && activeRoles.has("guest")
    ? "active"
    : "created";
}
