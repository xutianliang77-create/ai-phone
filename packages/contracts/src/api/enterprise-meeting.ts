export type EnterpriseMeetingStatus =
  | "scheduled"
  | "provisioning"
  | "active"
  | "ending"
  | "ended"
  | "cancelled"
  | "failed";

export type EnterpriseMeetingParticipantRole = "host" | "member" | "guest";
export type EnterpriseMeetingCaptionLanguage = "zh" | "en";

export const enterpriseMeetingTranslationTopic =
  "wujie.enterprise.meeting.translation.v1";

export interface EnterpriseMeetingPolicyDto {
  allowGuests: boolean;
  screenShareRole: "host_only" | "members";
  defaultLanguage?: string;
}

export interface EnterpriseMeetingDto {
  id: string;
  title: string;
  hostUserId: string;
  scheduledAt?: string;
  status: EnterpriseMeetingStatus;
  policy: EnterpriseMeetingPolicyDto;
  retentionUntil?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  version: number;
}

export interface EnterpriseMeetingParticipantDto {
  id: string;
  meetingId: string;
  role: EnterpriseMeetingParticipantRole;
  language?: string;
  captionLanguage: EnterpriseMeetingCaptionLanguage;
  translatedAudioEnabled: boolean;
  playbackGeneration: number;
  displayName: string;
  joinedAt?: string;
  leftAt?: string;
  version: number;
}

export interface EnterpriseMeetingArtifactDto {
  id: string;
  meetingId: string;
  artifactType: "transcript" | "summary" | "action_items" | "recording";
  status: "processing" | "ready" | "published" | "failed";
  createdAt: string;
  publishedAt?: string;
  version: number;
}

export interface EnterpriseMeetingAggregateDto {
  meeting: EnterpriseMeetingDto;
  participants: EnterpriseMeetingParticipantDto[];
  artifacts: EnterpriseMeetingArtifactDto[];
  communication?: {
    status: string;
    ready: boolean;
    updatedAt: string;
  };
}

export interface EnterpriseMeetingsResponse {
  meetings: EnterpriseMeetingAggregateDto[];
}

export interface EnterpriseMeetingResponse {
  meeting: EnterpriseMeetingAggregateDto;
  replayed?: boolean;
}

export interface CreateEnterpriseMeetingRequest {
  tenantId?: string;
  title: string;
  scheduledAt?: string;
  policy: EnterpriseMeetingPolicyDto;
}

export interface CreateEnterpriseMeetingGuestInvitationRequest {
  tenantId?: string;
  displayName: string;
  language?: string;
}

export interface EnterpriseMeetingGuestInvitationResponse {
  invitation: {
    meetingId: string;
    participantId: string;
    token: string;
    expiresAt: string;
  };
  replayed?: boolean;
}

export interface EnterpriseMeetingJoinTokenResponse {
  meetingId: string;
  communicationSessionId: string;
  participantId: string;
  participantRole: EnterpriseMeetingParticipantRole;
  participantIdentity: string;
  provider: "livekit";
  roomName: string;
  rtcUrl: string;
  accessToken: string;
  expiresAt: string;
  communicationStatus: string;
  translation: {
    status: "ready" | "captions_only" | "not_ready";
    reasonCode: string;
    topic: typeof enterpriseMeetingTranslationTopic;
    generation: number;
    captionLanguage: EnterpriseMeetingCaptionLanguage;
    translatedAudioEnabled: boolean;
    translatedAudioAvailable: boolean;
    playbackGeneration: number;
  };
  capabilities: {
    microphone: true;
    subscribe: true;
    camera: false;
    data: false;
    screenShare: false;
  };
}

export interface JoinEnterpriseMeetingGuestRequest {
  token: string;
  captionLanguage?: EnterpriseMeetingCaptionLanguage;
  translatedAudioEnabled?: boolean;
}

export interface JoinEnterpriseMeetingMemberRequest {
  tenantId?: string;
  displayName?: string;
  language?: string;
  captionLanguage?: EnterpriseMeetingCaptionLanguage;
  translatedAudioEnabled?: boolean;
}

export interface UpdateEnterpriseMeetingTranslationPreferenceRequest {
  tenantId?: string;
  captionLanguage: EnterpriseMeetingCaptionLanguage;
  translatedAudioEnabled: boolean;
  expectedVersion: number;
}

export interface EnterpriseMeetingTranslationPreferenceResponse {
  participant: EnterpriseMeetingParticipantDto;
}

export type EnterpriseMeetingScreenShareSource = "screen" | "window" | "tab";
export type EnterpriseMeetingScreenShareQuality = "auto" | "smooth" | "high";
export type EnterpriseMeetingScreenShareStatus =
  "active" | "paused" | "ended" | "expired";

export interface EnterpriseMeetingScreenShareDto {
  id: string;
  meetingId: string;
  participantId: string;
  communicationSessionId: string;
  sourceType: EnterpriseMeetingScreenShareSource;
  includesSystemAudio: boolean;
  qualityMode: EnterpriseMeetingScreenShareQuality;
  status: EnterpriseMeetingScreenShareStatus;
  generation: number;
  publisherIdentity: string;
  trackSid?: string;
  leaseExpiresAt?: string;
  startedAt: string;
  pausedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AcquireEnterpriseMeetingScreenShareRequest {
  sourceType: EnterpriseMeetingScreenShareSource;
  includesSystemAudio: boolean;
  qualityMode: EnterpriseMeetingScreenShareQuality;
  expectedMeetingVersion: number;
}

export interface ControlEnterpriseMeetingScreenShareRequest {
  expectedVersion: number;
}

export interface RenewEnterpriseMeetingScreenShareRequest
  extends ControlEnterpriseMeetingScreenShareRequest {
  trackSid?: string;
}

export interface EnterpriseMeetingScreenShareGrant {
  provider: "livekit";
  roomName: string;
  rtcUrl: string;
  publisherIdentity: string;
  accessToken: string;
  expiresAt: string;
  generation: number;
  capabilities: {
    screenShare: true;
    screenShareAudio: boolean;
    microphone: false;
    camera: false;
    data: false;
    subscribe: false;
  };
}

export interface EnterpriseMeetingScreenShareResponse {
  share: EnterpriseMeetingScreenShareDto;
  grant?: EnterpriseMeetingScreenShareGrant;
  replayed?: boolean;
  revocation: "not_required" | "completed" | "pending";
}

export interface EnterpriseMeetingCurrentScreenShareResponse {
  share: EnterpriseMeetingScreenShareDto | null;
  revocation: "not_required" | "completed" | "pending";
}

export interface EnterpriseMeetingCaptionEvent {
  v: 1;
  eventId: string;
  type: "transcript.final" | "translation.final";
  meetingId: string;
  communicationSessionId: string;
  targetParticipantId: string;
  sourceParticipantId: string;
  sourceDisplayName: string;
  sourceTrackSid: string;
  generation: number;
  segmentId: string;
  revision: number;
  sourceLanguage: EnterpriseMeetingCaptionLanguage;
  targetLanguage: EnterpriseMeetingCaptionLanguage;
  sourceText: string;
  text: string;
  translated: boolean;
  final: true;
  occurredAt: string;
  translatedAudio: {
    enabled: boolean;
    available: boolean;
    status: "disabled" | "not_ready" | "queued";
    playbackGeneration: number;
  };
}
