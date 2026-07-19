import type {
  EnterpriseMeetingScreenShareQuality,
  EnterpriseMeetingScreenShareSource,
} from "@translation/contracts";
import type {
  EnterpriseMeetingScreenShareRecord,
  EnterpriseMeetingScreenShareRevocation,
} from "./enterprise-meeting-screen-share.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

export interface EnterpriseMeetingScreenShareFailure {
  status: "not_found" | "not_joinable" | "forbidden" |
    "policy_denied" | "entitlement_not_ready" | "capacity_denied" |
    "route_not_ready" | "idempotency_conflict" | "conflict" |
    "invalid_transition" | "storage_required";
  revoked?: EnterpriseMeetingScreenShareRevocation[];
}

export interface EnterpriseMeetingScreenShareRuntime {
  currentMeetingScreenShare?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    now: Date;
  }): Promise<
    | { status: "ready"; share: EnterpriseMeetingScreenShareRecord | null;
        revoked: EnterpriseMeetingScreenShareRevocation[] }
    | EnterpriseMeetingScreenShareFailure
  >;
  acquireMeetingScreenShare?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    shareId: string;
    sourceType: EnterpriseMeetingScreenShareSource;
    includesSystemAudio: boolean;
    qualityMode: EnterpriseMeetingScreenShareQuality;
    expectedMeetingVersion: number;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
  }): Promise<
    | { status: "created" | "replayed"; share: EnterpriseMeetingScreenShareRecord;
        revoked: EnterpriseMeetingScreenShareRevocation[] }
    | { status: "busy"; share: EnterpriseMeetingScreenShareRecord;
        revoked: EnterpriseMeetingScreenShareRevocation[] }
    | EnterpriseMeetingScreenShareFailure
  >;
  commandMeetingScreenShare?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    shareId: string;
    command: "pause" | "resume" | "renew" | "stop";
    expectedVersion: number;
    trackSid?: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
  }): Promise<
    | { status: "updated" | "replayed"; share: EnterpriseMeetingScreenShareRecord;
        revoked: EnterpriseMeetingScreenShareRevocation[] }
    | { status: "expired" | "conflict" | "invalid_transition";
        share: EnterpriseMeetingScreenShareRecord;
        revoked: EnterpriseMeetingScreenShareRevocation[] }
    | EnterpriseMeetingScreenShareFailure
  >;
  forceStopMeetingScreenShare?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    shareId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
  }): Promise<
    | { status: "updated" | "replayed"; share: EnterpriseMeetingScreenShareRecord;
        revoked: EnterpriseMeetingScreenShareRevocation[] }
    | { status: "expired" | "conflict" | "invalid_transition";
        share: EnterpriseMeetingScreenShareRecord;
        revoked: EnterpriseMeetingScreenShareRevocation[] }
    | EnterpriseMeetingScreenShareFailure
  >;
}
