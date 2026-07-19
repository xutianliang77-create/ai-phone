import type { EnterpriseMeetingMaterialReview } from
  "../../modules/enterprise/enterprise-meeting-material.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export function validateMeetingMaterialReview(
  review: EnterpriseMeetingMaterialReview,
  ids: Set<string>,
) {
  if (review.status === "processing" ||
    (review.status === "ready") !== !review.reasonCode ||
    review.status === "ready" && (!review.providerFingerprint ||
      review.conclusions.length + review.actionItems.length < 1) ||
    review.status !== "ready" && (Boolean(review.providerFingerprint) ||
      review.conclusions.length + review.actionItems.length > 0)) {
    throw new Error("Invalid enterprise meeting material review status");
  }
  for (const item of [...review.conclusions, ...review.actionItems]) {
    const evidence = uniqueMeetingMaterialEvidence(item.evidenceSourceSegmentIds, ids);
    if (evidence.length < 1 ||
      evidence.length !== new Set(item.evidenceSourceSegmentIds).size) {
      throw new Error("Enterprise meeting material item has no valid evidence");
    }
  }
}

export function uniqueMeetingMaterialEvidence(values: string[], allowed: Set<string>) {
  return [...new Set(values)].filter((value) => allowed.has(value));
}

export function canManageMeetingMaterial(
  session: EnterpriseTenantPostgresSession,
  hostUserId: string,
) {
  return session.context.actorUserId === hostUserId ||
    session.context.actorRole === "owner" || session.context.actorRole === "admin";
}

export function materialUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)) throw new Error("Invalid enterprise meeting material ID");
  return value;
}

export function materialHash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid material hash");
  return value;
}

export function materialKey(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error("Invalid material idempotency key");
  }
  return value;
}

export function materialText(value: string, maximum: number) {
  const clean = value.trim();
  if (!clean || Array.from(clean).length > maximum) {
    throw new Error("Invalid enterprise meeting material text");
  }
  return clean;
}

export function materialIso(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("Invalid enterprise meeting material timestamp");
  }
  return value;
}

export interface MeetingMaterialMeetingRow extends Record<string, unknown> {
  id: string;
  host_user_id: string;
  status: string;
  version: number;
  retention_until: string | Date | null;
}
