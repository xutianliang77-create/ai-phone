import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  AddEnterpriseMeetingArtifactInput,
  AddEnterpriseMeetingParticipantInput,
  CreateEnterpriseMeetingInput,
  EnterpriseMeetingAggregate,
  EnterpriseMeetingStatus,
  EnterpriseMeetingParticipantRecord,
} from "./enterprise-meeting.js";
import type { EnterpriseCommunicationBindingRecord } from
  "./enterprise-communication-session.js";
import type {
  EnterpriseMeetingTranslationDelivery,
  EnterpriseMeetingWorkerCaptionInput,
} from "./enterprise-meeting-translation.js";

export interface EnterpriseMeetingTranslationDispatch {
  ticket: string;
  meetingId: string;
  communicationSessionId: string;
  roomName: string;
  agentName: string;
  generation: number;
  expiresAt: string;
  runtimeState: "full" | "captions_only" | "half_duplex";
  reasonCode: string;
}

export interface EnterpriseMeetingTranslationWorkerSnapshot {
  meetingId: string;
  communicationSessionId: string;
  roomName: string;
  generation: number;
  runtimeState: EnterpriseMeetingTranslationDispatch["runtimeState"];
  reasonCode: string;
}

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMeetingJoinAuthorization {
  aggregate: EnterpriseMeetingAggregate;
  participant: EnterpriseMeetingParticipantRecord;
  binding: EnterpriseCommunicationBindingRecord;
  routing: { homeRegion: string; cellId: string; routeEpoch: number };
}

export interface EnterpriseMeetingRepositoryRuntime {
  createMeeting?(input: {
    context: EnterpriseTenantContext;
    meeting: CreateEnterpriseMeetingInput;
  }): Promise<{ status: "created"; aggregate: EnterpriseMeetingAggregate } |
    { status: "replayed"; aggregate: EnterpriseMeetingAggregate } |
    { status: "idempotency_conflict" } | StorageRequired>;
  getMeeting?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
  }): Promise<{ status: "ready"; aggregate: EnterpriseMeetingAggregate } |
    { status: "not_found" } | StorageRequired>;
  listMeetings?(input: {
    context: EnterpriseTenantContext;
  }): Promise<{ status: "ready"; meetings: EnterpriseMeetingAggregate[] } |
    StorageRequired>;
  addMeetingParticipant?(input: {
    context: EnterpriseTenantContext;
    participant: AddEnterpriseMeetingParticipantInput;
  }): Promise<{ status: "created"; aggregate: EnterpriseMeetingAggregate } |
    { status: "not_found" | "conflict" } | StorageRequired>;
  addMeetingArtifact?(input: {
    context: EnterpriseTenantContext;
    artifact: AddEnterpriseMeetingArtifactInput;
  }): Promise<{ status: "created"; aggregate: EnterpriseMeetingAggregate } |
    { status: "not_found" | "conflict" } | StorageRequired>;
  transitionMeeting?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    status: EnterpriseMeetingStatus;
    expectedVersion: number;
    occurredAt: string;
  }): Promise<{ status: "updated"; aggregate: EnterpriseMeetingAggregate } |
    { status: "not_found" | "conflict" | "invalid_transition" } |
    StorageRequired>;
  listRecoverableMeetings?(input: {
    context: EnterpriseTenantContext;
  }): Promise<{ status: "ready"; meetings: EnterpriseMeetingAggregate[] } |
    StorageRequired>;
  createMeetingSession?(input: {
    context: EnterpriseTenantContext;
    meeting: CreateEnterpriseMeetingInput;
    hostParticipantId: string;
    bindingId: string;
    communicationSessionId: string;
  }): Promise<
    | { status: "created" | "replayed"; aggregate: EnterpriseMeetingAggregate }
    | { status: "idempotency_conflict" | "policy_not_ready" |
        "entitlement_not_ready" | "route_not_ready" }
    | StorageRequired
  >;
  inviteMeetingGuest?(input: {
    context: EnterpriseTenantContext;
    participant: AddEnterpriseMeetingParticipantInput;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<
    | { status: "created" | "replayed"; aggregate: EnterpriseMeetingAggregate;
        participant: EnterpriseMeetingParticipantRecord }
    | { status: "not_found" | "forbidden" | "not_joinable" | "conflict" }
    | StorageRequired
  >;
  authorizeMemberMeetingJoin?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    participantId?: string;
    displayName: string;
    language?: string;
    captionLanguage?: "zh" | "en";
    translatedAudioEnabled?: boolean;
    now: string;
  }): Promise<
    | { status: "authorized"; authorization: EnterpriseMeetingJoinAuthorization }
    | { status: "not_found" | "not_started" | "not_joinable" | "not_ready" }
    | StorageRequired
  >;
  authorizeGuestMeetingJoin?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    participantId: string;
    captionLanguage?: "zh" | "en";
    translatedAudioEnabled?: boolean;
    now: string;
  }): Promise<
    | { status: "authorized"; authorization: EnterpriseMeetingJoinAuthorization }
    | { status: "not_found" | "not_started" | "not_joinable" | "not_ready" }
    | StorageRequired
  >;
  prepareMeetingTranslation?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    now: string;
  }): Promise<
    | { status: "ready"; dispatch: EnterpriseMeetingTranslationDispatch }
    | { status: "not_ready"; reasonCode: string }
    | StorageRequired
  >;
  updateMeetingTranslationPreference?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    participantId?: string;
    captionLanguage: "zh" | "en";
    translatedAudioEnabled: boolean;
    expectedVersion?: number;
    joinedAt?: string;
  }): Promise<
    | { status: "updated"; participant: EnterpriseMeetingParticipantRecord }
    | { status: "not_found" | "forbidden" | "conflict" | "not_joinable" }
    | StorageRequired
  >;
  acceptMeetingTranslationWorker?(input: {
    ticket: string;
    workerCellId: string;
    workerId: string;
    traceId: string;
    leaseSeconds: number;
    now?: Date;
  }): Promise<
    | { status: "accepted"; snapshot: EnterpriseMeetingTranslationWorkerSnapshot }
    | { status: string }
  >;
  heartbeatMeetingTranslationWorker?(input: {
    ticket: string;
    workerCellId: string;
    workerId: string;
    traceId: string;
    leaseSeconds: number;
    now?: Date;
  }): Promise<{ status: string }>;
  refreshMeetingTranslationWorker?(input: {
    ticket: string;
    workerCellId: string;
    workerId: string;
    traceId: string;
    leaseSeconds: number;
    ticketTtlSeconds: number;
    now?: Date;
  }): Promise<{ status: string; ticket?: string; expiresAt?: string }>;
  publishMeetingTranslationEvents?(input: {
    ticket: string;
    workerCellId: string;
    workerId: string;
    traceId: string;
    sourceParticipantId: string;
    sourceTrackSid: string;
    events: EnterpriseMeetingWorkerCaptionInput[];
    now?: Date;
  }): Promise<
    | { status: "authorized"; deliveries: EnterpriseMeetingTranslationDelivery[] }
    | { status: string }
  >;
  finalizeMeetingTranslationWorker?(input: {
    ticket: string;
    workerCellId: string;
    workerId: string;
    traceId: string;
    outcome: "completed" | "failed";
    now?: Date;
  }): Promise<{ status: string }>;
}
