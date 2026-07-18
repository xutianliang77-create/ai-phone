import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  AddEnterpriseMeetingArtifactInput,
  AddEnterpriseMeetingParticipantInput,
  CreateEnterpriseMeetingInput,
  EnterpriseMeetingAggregate,
  EnterpriseMeetingStatus,
} from "./enterprise-meeting.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMeetingRepositoryRuntime {
  createMeeting?(input: {
    context: EnterpriseTenantContext;
    meeting: CreateEnterpriseMeetingInput;
  }): Promise<{ status: "created"; aggregate: EnterpriseMeetingAggregate } |
    { status: "conflict" } | StorageRequired>;
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
}
