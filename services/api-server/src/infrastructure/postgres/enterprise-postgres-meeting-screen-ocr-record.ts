import type {
  EnterpriseMeetingScreenOcrFrameRecord,
  EnterpriseMeetingScreenOcrRunRecord,
  EnterpriseMeetingScreenOcrSubscriptionRecord,
} from "../../modules/enterprise/enterprise-meeting-screen-ocr.js";

export interface ScreenOcrRunRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; share_id: string;
  share_generation: string | number; target_language: "zh" | "en";
  status: EnterpriseMeetingScreenOcrRunRecord["status"];
  reason_code: string | null; provider_fingerprint: string | null;
  created_by: string; created_at: string | Date; updated_at: string | Date;
  ended_at: string | Date | null; version: string | number;
}

export interface ScreenOcrSubscriptionRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; share_id: string;
  share_generation: string | number; run_id: string; participant_id: string;
  target_language: "zh" | "en";
  display_mode: "original" | "translated" | "bilingual";
  enabled: boolean; created_at: string | Date; updated_at: string | Date;
  version: string | number;
}

export interface ScreenOcrFrameRow extends Record<string, unknown> {
  id: string; tenant_id: string; meeting_id: string; share_id: string;
  run_id: string; frame_revision: string | number; perceptual_hash: string;
  source_width: number; source_height: number;
  status: EnterpriseMeetingScreenOcrFrameRecord["status"];
  reason_code: string | null; provider_fingerprint: string | null;
  captured_at: string | Date; created_at: string | Date;
  completed_at: string | Date | null;
}

export function mapScreenOcrRun(row: ScreenOcrRunRow, tenantId: string) {
  tenant(row.tenant_id, tenantId);
  return {
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    shareId: row.share_id, shareGeneration: positive(row.share_generation),
    targetLanguage: row.target_language, status: row.status,
    ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
    ...(row.provider_fingerprint
      ? { providerFingerprint: row.provider_fingerprint } : {}),
    createdBy: row.created_by, createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.ended_at ? { endedAt: iso(row.ended_at) } : {}),
    version: positive(row.version),
  } satisfies EnterpriseMeetingScreenOcrRunRecord;
}

export function mapScreenOcrSubscription(
  row: ScreenOcrSubscriptionRow,
  tenantId: string,
) {
  tenant(row.tenant_id, tenantId);
  return {
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    shareId: row.share_id, shareGeneration: positive(row.share_generation),
    runId: row.run_id, participantId: row.participant_id,
    targetLanguage: row.target_language, displayMode: row.display_mode,
    enabled: row.enabled, createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), version: positive(row.version),
  } satisfies EnterpriseMeetingScreenOcrSubscriptionRecord;
}

export function mapScreenOcrFrame(row: ScreenOcrFrameRow, tenantId: string) {
  tenant(row.tenant_id, tenantId);
  return {
    id: row.id, tenantId: row.tenant_id, meetingId: row.meeting_id,
    shareId: row.share_id, runId: row.run_id,
    frameRevision: positive(row.frame_revision),
    perceptualHash: row.perceptual_hash, sourceWidth: Number(row.source_width),
    sourceHeight: Number(row.source_height), status: row.status,
    ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
    ...(row.provider_fingerprint
      ? { providerFingerprint: row.provider_fingerprint } : {}),
    capturedAt: iso(row.captured_at), createdAt: iso(row.created_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
  } satisfies EnterpriseMeetingScreenOcrFrameRecord;
}

function tenant(actual: string, expected: string) {
  if (actual !== expected) throw new Error("Enterprise screen OCR tenant mismatch");
}
function positive(value: string | number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Invalid enterprise screen OCR integer");
  }
  return parsed;
}
function iso(value: string | Date) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Invalid enterprise screen OCR timestamp");
  }
  return parsed.toISOString();
}
