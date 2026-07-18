export type CallLinkStatus = "created" | "active" | "ended";

export interface CallLinkMetadata {
  roomName: string;
  roomProvider: "livekit";
  joinUrl: string;
  hostUrl: string;
  expiresAt: string;
  purpose?: "human_call" | "voice_agent";
  guestTicket?: CallGuestTicketRecord;
}

export interface CallGuestTicketRecord {
  callId: string;
  sessionId: string;
  role: "guest";
  nonceHash: string;
  ticketHash: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export type CallParticipantRole = "host" | "guest" | "worker";
export type CallJoinType = "app" | "web" | "worker" | "sip";
export type CallLegStatus = "active" | "ended";

export interface CallLegRecord {
  id: string;
  participantIdentity: string;
  participantRole: CallParticipantRole;
  joinType: CallJoinType;
  status: CallLegStatus;
  joinedAt: string;
  endedAt?: string;
}
