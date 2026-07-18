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
    participantId: string;
    displayName: string;
    language?: string;
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
    now: string;
  }): Promise<
    | { status: "authorized"; authorization: EnterpriseMeetingJoinAuthorization }
    | { status: "not_found" | "not_started" | "not_joinable" | "not_ready" }
    | StorageRequired
  >;
}
