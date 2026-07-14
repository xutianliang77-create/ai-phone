export type CallLinkStatus = "created" | "active" | "ended";

export interface CallLinkMetadata {
  roomName: string;
  roomProvider: "livekit";
  joinUrl: string;
  hostUrl: string;
  expiresAt: string;
}

export type CallParticipantRole = "host" | "guest" | "worker";
export type CallJoinType = "app" | "web" | "worker";
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
