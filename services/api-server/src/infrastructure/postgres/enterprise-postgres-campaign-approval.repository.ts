import { campaignApprovalDecisionHash,
  type EnterpriseCampaignApprovalDecisionRecord,
  type EnterpriseCampaignValidationSnapshotRecord } from
  "../../modules/enterprise/enterprise-campaign-approval.js";
import type { EnterpriseCampaignRecord } from
  "../../modules/enterprise/enterprise-campaign.js";
import { enterprisePostgresAccountSubjectId,
  enterprisePostgresActorSubjectId } from "./enterprise-postgres-subject-id.js";
import { buildEnterpriseCampaignValidationSnapshot } from
  "./enterprise-postgres-campaign-approval-snapshot.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseCampaignApprovalPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async get(campaignId: string) {
    const validations = await this.session.query<ValidationRow>(`
      SELECT * FROM enterprise.marketing_campaign_validation_snapshots
      WHERE tenant_id = $1 AND campaign_id = $2
      ORDER BY validated_at DESC, id DESC LIMIT 1
    `, [uuid(campaignId)]);
    const decisions = await this.session.query<DecisionRow>(`
      SELECT * FROM enterprise.marketing_campaign_approval_decisions
      WHERE tenant_id = $1 AND campaign_id = $2
      ORDER BY decided_at DESC, id DESC LIMIT 50
    `, [uuid(campaignId)]);
    return { latestValidation: validations.rows[0]
      ? mapValidation(validations.rows[0]) : undefined,
      decisions: decisions.rows.map(mapDecision) };
  }

  async validate(input: { campaign: EnterpriseCampaignRecord; validationId: string;
    expectedVersion: number; idempotencyKey: string; requestHash: string;
    validatedAt: string }) {
    await this.lock("validate", input.idempotencyKey);
    const replay = await this.validationByKey(input.idempotencyKey);
    if (replay) return replay.creationRequestHash === hash(input.requestHash)
      ? { status: "replayed" as const, validation: replay }
      : { status: "idempotency_conflict" as const };
    if (input.campaign.version !== input.expectedVersion) {
      return { status: "conflict" as const };
    }
    if (input.campaign.status !== "draft" || !["not_submitted", "rejected"]
      .includes(input.campaign.approvalStatus)) return { status: "not_validatable" as const };
    const validatedAt = nextIso(input.validatedAt, input.campaign.updatedAt);
    const validation = await buildEnterpriseCampaignValidationSnapshot({
      session: this.session, campaign: input.campaign, id: uuid(input.validationId),
      validatedBy: this.session.context.actorUserId, validatedAt,
      creationKey: eventKey(input.idempotencyKey),
      creationRequestHash: hash(input.requestHash),
    });
    await this.insertValidation(validation);
    if (validation.status === "ready") {
      const validatingAt = validatedAt;
      const pendingAt = new Date(Date.parse(validatingAt) + 1).toISOString();
      const first = await this.session.query<{ id: string }>(`
        UPDATE enterprise.marketing_campaigns
        SET status = 'validating', approval_status = 'not_submitted',
          approval_snapshot_id = NULL, policy_version = NULL,
          updated_at = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $4
          AND status = 'draft' AND approval_status IN ('not_submitted', 'rejected')
        RETURNING id
      `, [uuid(input.campaign.id), validatingAt, input.expectedVersion]);
      if (first.rows.length !== 1) throw new Error("Campaign validation transition failed");
      const second = await this.session.query<{ id: string }>(`
        UPDATE enterprise.marketing_campaigns
        SET status = 'pending_approval', approval_status = 'pending',
          updated_at = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $4
          AND status = 'validating' AND approval_status = 'not_submitted'
        RETURNING id
      `, [uuid(input.campaign.id), pendingAt, input.expectedVersion + 1]);
      if (second.rows.length !== 1) throw new Error("Campaign submission transition failed");
    }
    return { status: "created" as const, validation };
  }

  async decide(input: { campaign: EnterpriseCampaignRecord; decisionId: string;
    validationSnapshotId: string; decision: "approved" | "rejected";
    reason?: string; expectedVersion: number; idempotencyKey: string;
    requestHash: string; decidedAt: string }) {
    await this.lock("decision", input.idempotencyKey);
    const replay = await this.decisionByKey(input.idempotencyKey);
    if (replay) return replay.creationRequestHash === hash(input.requestHash)
      ? { status: "replayed" as const, decision: replay }
      : { status: "idempotency_conflict" as const };
    if (input.campaign.version !== input.expectedVersion) {
      return { status: "conflict" as const };
    }
    if (input.campaign.status !== "pending_approval" ||
      input.campaign.approvalStatus !== "pending") {
      return { status: "not_decidable" as const };
    }
    const validation = await this.validationById(input.validationSnapshotId);
    if (!validation || validation.campaignId !== input.campaign.id ||
      validation.status !== "ready" ||
      input.campaign.version !== validation.sourceCampaignVersion + 2) {
      return { status: "validation_stale" as const };
    }
    const decidedAt = nextIso(input.decidedAt, input.campaign.updatedAt);
    if (input.decision === "approved") {
      const current = await buildEnterpriseCampaignValidationSnapshot({
        session: this.session, campaign: input.campaign, id: validation.id,
        validatedBy: validation.validatedBy, validatedAt: decidedAt,
        creationKey: validation.creationKey,
        creationRequestHash: validation.creationRequestHash,
      });
      if (current.status !== "ready" || current.snapshotHash !== validation.snapshotHash) {
        return { status: "validation_stale" as const };
      }
    }
    const rejectionReason = input.decision === "rejected"
      ? bounded(input.reason, 1_000) : undefined;
    const decision: EnterpriseCampaignApprovalDecisionRecord = {
      id: uuid(input.decisionId), tenantId: input.campaign.tenantId,
      campaignId: input.campaign.id, validationSnapshotId: validation.id,
      decision: input.decision, ...(rejectionReason ? { rejectionReason } : {}),
      decisionHash: campaignApprovalDecisionHash({ campaignId: input.campaign.id,
        validationSnapshotId: validation.id, decision: input.decision,
        ...(rejectionReason ? { rejectionReason } : {}),
        decidedBy: this.session.context.actorUserId, decidedAt }),
      decidedBy: this.session.context.actorUserId, decidedAt,
      creationKey: eventKey(input.idempotencyKey),
      creationRequestHash: hash(input.requestHash), version: 1 };
    await this.insertDecision(decision);
    const result = input.decision === "approved"
      ? await this.session.query<{ id: string }>(`
          UPDATE enterprise.marketing_campaigns
          SET status = 'approved', approval_status = 'approved',
            approval_snapshot_id = $3, policy_version = $4,
            updated_at = $5, version = version + 1
          WHERE tenant_id = $1 AND id = $2 AND version = $6
            AND status = 'pending_approval' AND approval_status = 'pending'
          RETURNING id
        `, [uuid(input.campaign.id), decision.id, validation.snapshotHash,
          decidedAt, input.expectedVersion])
      : await this.session.query<{ id: string }>(`
          UPDATE enterprise.marketing_campaigns
          SET status = 'draft', approval_status = 'rejected',
            approval_snapshot_id = NULL, policy_version = NULL,
            updated_at = $3, version = version + 1
          WHERE tenant_id = $1 AND id = $2 AND version = $4
            AND status = 'pending_approval' AND approval_status = 'pending'
          RETURNING id
        `, [uuid(input.campaign.id), decidedAt, input.expectedVersion]);
    if (result.rows.length !== 1) throw new Error("Campaign decision transition failed");
    return { status: input.decision as "approved" | "rejected", decision };
  }

  private async insertValidation(value: EnterpriseCampaignValidationSnapshotRecord) {
    await this.session.query(`
      INSERT INTO enterprise.marketing_campaign_validation_snapshots(
        tenant_id, id, campaign_id, source_campaign_version, status, target_at,
        campaign_snapshot, campaign_hash, policy_set, policy_set_hash,
        lead_set, lead_set_hash, consent_set, consent_set_hash,
        suppression_set, suppression_set_hash, issues, snapshot_hash,
        validated_by, validated_at, creation_key, creation_request_hash, version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11::jsonb,$12,
        $13::jsonb,$14,$15::jsonb,$16,$17::jsonb,$18,$19,$20,$21,$22,1)
    `, [value.id, value.campaignId, value.sourceCampaignVersion, value.status,
      value.targetAt ?? null, JSON.stringify(value.campaignSnapshot), value.campaignHash,
      JSON.stringify(value.policies), value.policySetHash, JSON.stringify(value.leads),
      value.leadSetHash, JSON.stringify(value.consents), value.consentSetHash,
      JSON.stringify(value.suppressions), value.suppressionSetHash,
      JSON.stringify(value.issues), value.snapshotHash,
      enterprisePostgresActorSubjectId(value.validatedBy), value.validatedAt,
      value.creationKey, value.creationRequestHash]);
  }
  private async insertDecision(value: EnterpriseCampaignApprovalDecisionRecord) {
    await this.session.query(`
      INSERT INTO enterprise.marketing_campaign_approval_decisions(
        tenant_id, id, campaign_id, validation_snapshot_id, decision,
        rejection_reason, decision_hash, decided_by, decided_at,
        creation_key, creation_request_hash, version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)
    `, [value.id, value.campaignId, value.validationSnapshotId, value.decision,
      value.rejectionReason ?? null, value.decisionHash,
      enterprisePostgresActorSubjectId(value.decidedBy), value.decidedAt,
      value.creationKey, value.creationRequestHash]);
  }
  private async validationByKey(key: string) {
    const result = await this.session.query<ValidationRow>(`
      SELECT * FROM enterprise.marketing_campaign_validation_snapshots
      WHERE tenant_id = $1 AND validated_by = $2 AND creation_key = $3
    `, [enterprisePostgresActorSubjectId(this.session.context.actorUserId), eventKey(key)]);
    return result.rows[0] ? mapValidation(result.rows[0]) : null;
  }
  private async validationById(id: string) {
    const result = await this.session.query<ValidationRow>(`
      SELECT * FROM enterprise.marketing_campaign_validation_snapshots
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [uuid(id)]);
    return result.rows[0] ? mapValidation(result.rows[0]) : null;
  }
  private async decisionByKey(key: string) {
    const result = await this.session.query<DecisionRow>(`
      SELECT * FROM enterprise.marketing_campaign_approval_decisions
      WHERE tenant_id = $1 AND decided_by = $2 AND creation_key = $3
    `, [enterprisePostgresActorSubjectId(this.session.context.actorUserId), eventKey(key)]);
    return result.rows[0] ? mapDecision(result.rows[0]) : null;
  }
  private async lock(scope: string, key: string) { await this.session.query(`
    SELECT pg_advisory_xact_lock(hashtextextended(
      $1::text || ':campaign-approval:' || $2 || ':' || $3, 0))
    FROM (SELECT $1::text AS tenant_id) lock_scope WHERE tenant_id = $1
  `, [scope, eventKey(key)]); }
}

interface ValidationRow extends Record<string, unknown> { id: string; tenant_id: string;
  campaign_id: string; source_campaign_version: number | string; status: string;
  target_at: string | Date | null; campaign_snapshot: unknown; campaign_hash: string;
  policy_set: unknown; policy_set_hash: string; lead_set: unknown; lead_set_hash: string;
  consent_set: unknown; consent_set_hash: string; suppression_set: unknown;
  suppression_set_hash: string; issues: unknown; snapshot_hash: string;
  validated_by: string; validated_at: string | Date; creation_key: string;
  creation_request_hash: string; version: number | string; }
interface DecisionRow extends Record<string, unknown> { id: string; tenant_id: string;
  campaign_id: string; validation_snapshot_id: string; decision: string;
  rejection_reason: string | null; decision_hash: string; decided_by: string;
  decided_at: string | Date; creation_key: string; creation_request_hash: string;
  version: number | string; }
function mapValidation(row: ValidationRow): EnterpriseCampaignValidationSnapshotRecord {
  if (row.status !== "ready" && row.status !== "blocked") throw new Error("Invalid validation status");
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), campaignId: uuid(row.campaign_id),
    sourceCampaignVersion: positive(row.source_campaign_version), status: row.status,
    ...(row.target_at ? { targetAt: iso(row.target_at) } : {}),
    campaignSnapshot: object(row.campaign_snapshot), campaignHash: hash(row.campaign_hash),
    policies: array(row.policy_set), policySetHash: hash(row.policy_set_hash),
    leads: array(row.lead_set), leadSetHash: hash(row.lead_set_hash),
    consents: array(row.consent_set), consentSetHash: hash(row.consent_set_hash),
    suppressions: array(row.suppression_set), suppressionSetHash: hash(row.suppression_set_hash),
    issues: array(row.issues), snapshotHash: hash(row.snapshot_hash),
    validatedBy: enterprisePostgresAccountSubjectId(row.validated_by),
    validatedAt: iso(row.validated_at), creationKey: eventKey(row.creation_key),
    creationRequestHash: hash(row.creation_request_hash), version: positive(row.version) };
}
function mapDecision(row: DecisionRow): EnterpriseCampaignApprovalDecisionRecord {
  if (row.decision !== "approved" && row.decision !== "rejected") throw new Error("Invalid decision");
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), campaignId: uuid(row.campaign_id),
    validationSnapshotId: uuid(row.validation_snapshot_id), decision: row.decision,
    ...(row.rejection_reason ? { rejectionReason: bounded(row.rejection_reason, 1_000) } : {}),
    decisionHash: hash(row.decision_hash),
    decidedBy: enterprisePostgresAccountSubjectId(row.decided_by),
    decidedAt: iso(row.decided_at), creationKey: eventKey(row.creation_key),
    creationRequestHash: hash(row.creation_request_hash), version: positive(row.version) };
}
function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid approval UUID"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid approval hash"); return value; }
function eventKey(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error("Invalid approval key"); return value; }
function positive(value: unknown) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid approval number"); return result; }
function bounded(value: unknown, max: number) { if (typeof value !== "string" || value !== value.trim() || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > max) throw new Error("Invalid approval text"); return value; }
function iso(value: unknown) { const result = value instanceof Date ? value.toISOString() : value; if (typeof result !== "string" || new Date(result).toISOString() !== result) throw new Error("Invalid approval timestamp"); return result; }
function nextIso(value: unknown, after: string) { const result = iso(value); return result > after ? result : new Date(Date.parse(after) + 1).toISOString(); }
function array<T>(value: unknown) { if (!Array.isArray(value)) throw new Error("Invalid approval array"); return value as T[]; }
function object(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid approval object"); return value as Record<string, unknown>; }
