import { randomUUID } from "node:crypto";
import {
  createSession,
  findSession,
  upsertCallLeg,
} from "../sessions/sessions-runtime.repository.js";
import {
  createUsageHold,
} from "../usage/usage-hold-runtime.service.js";
import { callRoomName } from "./call-room-token.js";
import {
  guestJoinUrl,
  issueCallGuestTicket,
} from "./call-guest-ticket.js";
import { replaceCallGuestTicket } from "./call-guest-ticket-runtime.js";
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
  purpose: "human_call" | "voice_agent";
  expiresAt: string;
  guestTicketExpiresAt?: string;
  createdAt: string;
  endedAt?: string;
}

const callLinkStartHoldSeconds = 60;

export async function createCallLink(options: {
  userId: string;
  publicBaseUrl: string;
  ttlSeconds?: number;
  guestTicketTtlSeconds?: number;
  now?: Date;
}): Promise<CallLinkRecord | null> {
  const now = options.now ?? new Date();
  const callId = randomUUID();
  const ttlSeconds = options.ttlSeconds ?? 3600;
  const hold = await createUsageHold(options.userId, callLinkStartHoldSeconds, {
    sessionId: callId,
    idempotencyKey: `hold:${callId}`,
    note: "call_link_session_hold",
    ttlSeconds,
  });
  if (hold.status !== "held") return null;
  const expiresAt = new Date(
    now.getTime() + ttlSeconds * 1000,
  );
  const baseUrl = normalizeBaseUrl(options.publicBaseUrl);
  const roomName = callRoomName(callId);
  const baseJoinUrl = `${baseUrl}/join/${callId}`;
  const guestTicket = issueCallGuestTicket({
    callId,
    sessionId: callId,
    callExpiresAt: expiresAt.toISOString(),
    ttlSeconds: options.guestTicketTtlSeconds ?? 300,
    now,
  });
  const record: CallLinkRecord = {
    callId,
    userId: options.userId,
    sessionId: callId,
    roomName,
    roomProvider: "livekit",
    joinUrl: guestJoinUrl(baseJoinUrl, guestTicket.ticket),
    hostUrl: `${baseUrl}/host/${callId}`,
    status: "created",
    version: 1,
    mode: "call_link",
    purpose: "human_call",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    guestTicketExpiresAt: guestTicket.record.expiresAt,
  };
  await createSession({
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
      joinUrl: baseJoinUrl,
      hostUrl: record.hostUrl,
      expiresAt: record.expiresAt,
      purpose: record.purpose,
      guestTicket: guestTicket.record,
    },
  });
  return record;
}

export async function findCallLink(callId: string): Promise<CallLinkRecord | null> {
  const session = await findSession(callId);
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
    purpose: session.callLink.purpose ?? "human_call",
    expiresAt: session.callLink.expiresAt,
    guestTicketExpiresAt: session.callLink.guestTicket?.expiresAt,
    createdAt: session.createdAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
  };
}

export async function rotateCallLinkGuestTicket(options: {
  callId: string;
  ttlSeconds: number;
  now?: Date;
}) {
  const record = await findCallLink(options.callId);
  const now = options.now ?? new Date();
  if (!record || record.purpose !== "human_call" || record.status === "ended" ||
    now.getTime() > Date.parse(record.expiresAt)) return null;
  const issued = issueCallGuestTicket({
    callId: record.callId,
    sessionId: record.sessionId,
    callExpiresAt: record.expiresAt,
    ttlSeconds: options.ttlSeconds,
    now,
  });
  if (!await replaceCallGuestTicket(record.sessionId, issued.record)) return null;
  return {
    callId: record.callId,
    joinUrl: guestJoinUrl(record.joinUrl, issued.ticket),
    expiresAt: issued.record.expiresAt,
  };
}

export async function registerCallLeg(options: {
  callId: string;
  participantIdentity: string;
  participantRole: CallParticipantRole;
  joinType: CallJoinType;
  joinedAt?: string;
}) {
  const record = await findCallLink(options.callId);
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

export async function hasActiveHumanCallPair(callId: string) {
  const record = await findCallLink(callId);
  if (!record || record.status === "ended") return false;
  const session = await findSession(record.sessionId);
  const activeRoles = new Set(
    (session?.callLegs ?? [])
      .filter((leg) => leg.status === "active")
      .map((leg) => leg.participantRole),
  );
  return activeRoles.has("host") && activeRoles.has("guest");
}

export async function hasActiveCallWorker(callId: string) {
  const record = await findCallLink(callId);
  if (!record || record.status === "ended") return false;
  const session = await findSession(record.sessionId);
  return (session?.callLegs ?? []).some(
    (leg) => leg.status === "active" && leg.participantRole === "worker",
  );
}

export async function persistedCallRoomHumanPresence(callId: string) {
  const record = await findCallLink(callId);
  const session = record ? await findSession(record.sessionId) : null;
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
