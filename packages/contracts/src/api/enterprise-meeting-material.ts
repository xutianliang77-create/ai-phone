export type EnterpriseMeetingMaterialReviewStatus =
  | "processing"
  | "not_configured"
  | "ready"
  | "failed";

export type EnterpriseMeetingMaterialConclusionKind =
  | "summary"
  | "topic"
  | "decision"
  | "objection"
  | "risk"
  | "unresolved";

export interface EnterpriseMeetingMaterialRunDto {
  id: string;
  meetingId: string;
  revision: number;
  status: "draft" | "published";
  sourceEventCount: number;
  sourceHash: string;
  reviewStatus: EnterpriseMeetingMaterialReviewStatus;
  reviewReasonCode?: string;
  providerFingerprint?: string;
  retentionUntil?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  version: number;
}

export interface EnterpriseMeetingMaterialSegmentDto {
  id: string;
  ordinal: number;
  sourceParticipantId: string;
  speakerLabel: string;
  sourceTrackSid: string;
  sourceSegmentId: string;
  revision: number;
  sourceLanguage: "zh" | "en";
  sourceText: string;
  translations: Array<{
    language: "zh" | "en";
    text: string;
  }>;
  occurredAt: string;
}

export interface EnterpriseMeetingMaterialConclusionDto {
  id: string;
  kind: EnterpriseMeetingMaterialConclusionKind;
  ordinal: number;
  text: string;
  evidenceSegmentIds: string[];
}

export interface EnterpriseMeetingMaterialActionItemDto {
  id: string;
  ordinal: number;
  text: string;
  ownerParticipantId?: string;
  dueAt?: string;
  priority?: "low" | "medium" | "high";
  status: "open" | "completed" | "cancelled";
  evidenceSegmentIds: string[];
  version: number;
}

export interface EnterpriseMeetingMaterialDto {
  run: EnterpriseMeetingMaterialRunDto;
  segments: EnterpriseMeetingMaterialSegmentDto[];
  conclusions: EnterpriseMeetingMaterialConclusionDto[];
  actionItems: EnterpriseMeetingMaterialActionItemDto[];
}

export interface EnterpriseMeetingMaterialResponse {
  material: EnterpriseMeetingMaterialDto | null;
  replayed?: true;
}

export interface GenerateEnterpriseMeetingMaterialRequest {
  tenantId?: string;
  expectedMeetingVersion: number;
}

export interface PublishEnterpriseMeetingMaterialRequest {
  tenantId?: string;
  expectedVersion: number;
}

export interface UpdateEnterpriseMeetingMaterialSpeakerRequest {
  tenantId?: string;
  displayName: string;
  expectedVersion: number;
}

export interface UpdateEnterpriseMeetingActionItemRequest {
  tenantId?: string;
  status: "open" | "completed" | "cancelled";
  expectedVersion: number;
}

export interface EndEnterpriseMeetingRequest {
  tenantId?: string;
  expectedVersion: number;
}
