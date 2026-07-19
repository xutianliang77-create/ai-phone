import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  EnterpriseMeetingMaterialRecord,
  EnterpriseMeetingMaterialReview,
  EnterpriseMeetingMaterialRunRecord,
  EnterpriseMeetingMaterialSourceSegment,
} from "./enterprise-meeting-material.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMeetingMaterialRuntime {
  prepareMeetingMaterial?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    expectedMeetingVersion: number;
    idempotencyKey: string;
    requestHash: string;
    occurredAt: string;
  }): Promise<
    | { status: "created" | "replayed"; run: EnterpriseMeetingMaterialRunRecord;
        segments: EnterpriseMeetingMaterialSourceSegment[]; finalized: false }
    | { status: "replayed"; run: EnterpriseMeetingMaterialRunRecord;
        material: EnterpriseMeetingMaterialRecord; finalized: true }
    | { status: "not_found" | "forbidden" | "not_ended" | "conflict" |
        "idempotency_conflict" | "no_source_events" }
    | StorageRequired
  >;
  finalizeMeetingMaterial?(input: {
    context: EnterpriseTenantContext;
    meetingId: string;
    runId: string;
    expectedVersion: number;
    sourceHash: string;
    segments: EnterpriseMeetingMaterialSourceSegment[];
    review: EnterpriseMeetingMaterialReview;
    occurredAt: string;
  }): Promise<
    | { status: "finalized" | "replayed"; material: EnterpriseMeetingMaterialRecord }
    | { status: "not_found" | "conflict" }
    | StorageRequired
  >;
  currentMeetingMaterial?(input: {
    context: EnterpriseTenantContext; meetingId: string;
  }): Promise<
    | { status: "ready"; material: EnterpriseMeetingMaterialRecord | null }
    | { status: "not_found" }
    | StorageRequired
  >;
  publishMeetingMaterial?(input: {
    context: EnterpriseTenantContext; meetingId: string; runId: string;
    expectedVersion: number; occurredAt: string;
  }): Promise<
    | { status: "published"; material: EnterpriseMeetingMaterialRecord;
        replayed?: true }
    | { status: "not_found" | "forbidden" | "conflict" | "review_not_ready" }
    | StorageRequired
  >;
  updateMeetingMaterialSpeaker?(input: {
    context: EnterpriseTenantContext; meetingId: string; runId: string;
    participantId: string; displayName: string; expectedVersion: number;
    occurredAt: string;
  }): Promise<
    | { status: "updated"; material: EnterpriseMeetingMaterialRecord }
    | { status: "not_found" | "forbidden" | "conflict" }
    | StorageRequired
  >;
  updateMeetingMaterialAction?(input: {
    context: EnterpriseTenantContext; meetingId: string; runId: string;
    actionItemId: string; status: "open" | "completed" | "cancelled";
    expectedVersion: number; occurredAt: string;
  }): Promise<
    | { status: "updated"; material: EnterpriseMeetingMaterialRecord }
    | { status: "not_found" | "forbidden" | "conflict" }
    | StorageRequired
  >;
  endMeetingForMaterials?(input: {
    context: EnterpriseTenantContext; meetingId: string;
    expectedVersion: number; occurredAt: string;
  }): Promise<
    | { status: "ended"; meetingVersion: number }
    | { status: "not_found" | "forbidden" | "conflict" |
        "invalid_transition" | "screen_share_active" }
    | StorageRequired
  >;
}
