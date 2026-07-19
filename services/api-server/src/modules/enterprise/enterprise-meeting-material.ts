import type {
  EnterpriseMeetingMaterialActionItemDto,
  EnterpriseMeetingMaterialConclusionDto,
  EnterpriseMeetingMaterialDto,
  EnterpriseMeetingMaterialReviewStatus,
  EnterpriseMeetingMaterialRunDto,
  EnterpriseMeetingMaterialSegmentDto,
} from "@translation/contracts";

export type EnterpriseMeetingMaterialRunRecord = EnterpriseMeetingMaterialRunDto & {
  tenantId: string;
  idempotencyKey: string;
  requestHash: string;
  createdBy: string;
};

export type EnterpriseMeetingMaterialSegmentRecord =
  EnterpriseMeetingMaterialSegmentDto & {
    tenantId: string;
    meetingId: string;
    materialRunId: string;
  };

export type EnterpriseMeetingMaterialConclusionRecord =
  EnterpriseMeetingMaterialConclusionDto & {
    tenantId: string;
    meetingId: string;
    materialRunId: string;
  };

export type EnterpriseMeetingMaterialActionItemRecord =
  EnterpriseMeetingMaterialActionItemDto & {
    tenantId: string;
    meetingId: string;
    materialRunId: string;
    createdAt: string;
    updatedAt: string;
  };

export interface EnterpriseMeetingMaterialRecord {
  run: EnterpriseMeetingMaterialRunRecord;
  segments: EnterpriseMeetingMaterialSegmentRecord[];
  conclusions: EnterpriseMeetingMaterialConclusionRecord[];
  actionItems: EnterpriseMeetingMaterialActionItemRecord[];
}

export interface EnterpriseMeetingMaterialSourceSegment {
  id: string;
  sourceParticipantId: string;
  sourceDisplayName: string;
  sourceTrackSid: string;
  sourceSegmentId: string;
  revision: number;
  sourceLanguage: "zh" | "en";
  sourceText: string;
  translations: Array<{ language: "zh" | "en"; text: string }>;
  occurredAt: string;
}

export interface EnterpriseMeetingMaterialReviewItem {
  kind: EnterpriseMeetingMaterialConclusionDto["kind"];
  text: string;
  evidenceSourceSegmentIds: string[];
}

export interface EnterpriseMeetingMaterialReviewAction {
  text: string;
  ownerParticipantId?: string;
  dueAt?: string;
  priority?: "low" | "medium" | "high";
  evidenceSourceSegmentIds: string[];
}

export type EnterpriseMeetingMaterialReview = {
  status: EnterpriseMeetingMaterialReviewStatus;
  reasonCode?: string;
  providerFingerprint?: string;
  conclusions: EnterpriseMeetingMaterialReviewItem[];
  actionItems: EnterpriseMeetingMaterialReviewAction[];
};

export function enterpriseMeetingMaterialDto(
  material: EnterpriseMeetingMaterialRecord,
): EnterpriseMeetingMaterialDto {
  return {
    run: publicRun(material.run),
    segments: material.segments.map(publicSegment),
    conclusions: material.conclusions.map(publicConclusion),
    actionItems: material.actionItems.map(publicAction),
  };
}

function publicRun(value: EnterpriseMeetingMaterialRunRecord) {
  const {
    tenantId: _tenantId,
    idempotencyKey: _idempotencyKey,
    requestHash: _requestHash,
    createdBy: _createdBy,
    ...run
  } = value;
  return run;
}

function publicSegment(value: EnterpriseMeetingMaterialSegmentRecord) {
  const {
    tenantId: _tenantId,
    meetingId: _meetingId,
    materialRunId: _materialRunId,
    ...segment
  } = value;
  return segment;
}

function publicConclusion(value: EnterpriseMeetingMaterialConclusionRecord) {
  const {
    tenantId: _tenantId,
    meetingId: _meetingId,
    materialRunId: _materialRunId,
    ...conclusion
  } = value;
  return conclusion;
}

function publicAction(value: EnterpriseMeetingMaterialActionItemRecord) {
  const {
    tenantId: _tenantId,
    meetingId: _meetingId,
    materialRunId: _materialRunId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...action
  } = value;
  return action;
}
