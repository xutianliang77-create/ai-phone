import type { EnterpriseCampaignScheduleDto } from "@translation/contracts";
import {
  campaignScheduleBlock,
  mergeCampaignDraft,
  type CreateEnterpriseCampaignInput,
  type EnterpriseCampaignRecord,
} from "../../modules/enterprise/enterprise-campaign.js";
import { enterprisePostgresAccountSubjectId, enterprisePostgresActorSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { enterpriseCampaignApprovalSnapshotBlock,
  enterpriseCampaignCountryPolicyBlock } from
  "./enterprise-postgres-campaign-approval-snapshot.js";

export class EnterpriseCampaignPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async create(input: CreateEnterpriseCampaignInput) {
    const value = campaignContent(input);
    const result = await this.session.query<CampaignRow>(`
      INSERT INTO enterprise.marketing_campaigns(
        tenant_id, id, name, objective, owner_user_id, country_codes,
        language_codes, status, approval_status, policy_version, schedule,
        concurrency_limit, created_at, updated_at, version,
        creation_key, creation_request_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'not_submitted', NULL,
        $8::jsonb, $9, $10, $10, 1, $11, $12)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [uuid(input.id), value.name, value.objective,
      enterprisePostgresAccountSubjectId(input.ownerUserId), value.countryCodes,
      value.languageCodes, JSON.stringify(value.schedule), value.concurrencyLimit,
      iso(input.createdAt), eventKey(input.idempotencyKey), hash(input.requestHash)]);
    if (result.rows[0]) {
      return { status: "created" as const, campaign: mapCampaign(result.rows[0]) };
    }
    const replay = await this.findByCreationKey(input.idempotencyKey);
    if (!replay || replay.requestHash !== input.requestHash) {
      return { status: "idempotency_conflict" as const };
    }
    return { status: "replayed" as const, campaign: replay.campaign };
  }

  async findByCreationKey(key: string) {
    const result = await this.session.query<CampaignRow>(`
      SELECT * FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1 AND creation_key = $2
    `, [eventKey(key)]);
    const row = result.rows[0];
    return row ? { campaign: mapCampaign(row), requestHash: row.creation_request_hash }
      : null;
  }

  async find(campaignId: string, lock = false) {
    const result = await this.session.query<CampaignRow>(`
      SELECT * FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(campaignId)]);
    return result.rows[0] ? mapCampaign(result.rows[0]) : null;
  }

  async list() {
    const result = await this.session.query<CampaignRow>(`
      SELECT * FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1
      ORDER BY updated_at DESC, id
      LIMIT 200
    `);
    return result.rows.map(mapCampaign);
  }

  async updateDraft(input: {
    campaignId: string; expectedVersion: number;
    patch: Parameters<typeof mergeCampaignDraft>[1]; updatedAt: string;
    idempotencyKey: string; requestHash: string;
  }) {
    const replay = await this.replayMutation({ ...input, route: "campaign.draft_update" });
    if (replay?.status === "blocked") return { status: "idempotency_conflict" as const };
    if (replay) return replay;
    const current = await this.find(input.campaignId, true);
    if (!current) return { status: "not_found" as const };
    if (current.version !== input.expectedVersion) return { status: "conflict" as const };
    if (current.status !== "draft" || !["not_submitted", "rejected"]
      .includes(current.approvalStatus)) {
      return { status: "not_editable" as const };
    }
    const value = campaignContent(mergeCampaignDraft(current, input.patch));
    const updatedAt = nextIso(input.updatedAt, current.updatedAt);
    const result = await this.session.query<CampaignRow>(`
      UPDATE enterprise.marketing_campaigns
      SET name = $3, objective = $4, country_codes = $5, language_codes = $6,
        schedule = $7::jsonb, concurrency_limit = $8, updated_at = $9,
        approval_status = 'not_submitted', approval_snapshot_id = NULL,
        policy_version = NULL, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $10
        AND status = 'draft' AND approval_status IN ('not_submitted', 'rejected')
      RETURNING *
    `, [uuid(input.campaignId), bounded(value.name, 200),
      bounded(value.objective, 2_000), value.countryCodes, value.languageCodes,
      JSON.stringify(value.schedule), value.concurrencyLimit, updatedAt,
      input.expectedVersion]);
    if (!result.rows[0]) return { status: "conflict" as const };
    const campaign = mapCampaign(result.rows[0]);
    await this.recordMutation({ ...input, route: "campaign.draft_update", campaign });
    return { status: "updated" as const, campaign };
  }

  async schedule(input: {
    campaignId: string; expectedVersion: number; occurredAt: string;
    idempotencyKey: string; requestHash: string;
  }) {
    const replay = await this.replayMutation({ ...input, route: "campaign.schedule" });
    if (replay) return replay;
    const current = await this.find(input.campaignId, true);
    if (!current) return { status: "not_found" as const };
    if (current.version !== input.expectedVersion) return { status: "conflict" as const };
    const occurredAt = nextIso(input.occurredAt, current.updatedAt);
    const reasonCode = campaignScheduleBlock(current, occurredAt);
    if (reasonCode) {
      await this.recordCommand({ ...input, route: "campaign.schedule" },
        `campaign-blocked:${reasonCode}`, 409, occurredAt);
      return { status: "blocked" as const, reasonCode };
    }
    const approvalReason = await enterpriseCampaignApprovalSnapshotBlock(
      this.session, current, occurredAt,
    );
    if (approvalReason) {
      await this.recordCommand({ ...input, route: "campaign.schedule" },
        `campaign-blocked:${approvalReason}`, 409, occurredAt);
      return { status: "blocked" as const, reasonCode: approvalReason };
    }
    const countryPolicyReason = await enterpriseCampaignCountryPolicyBlock(
      this.session, current,
    );
    if (countryPolicyReason) {
      await this.recordCommand({ ...input, route: "campaign.schedule" },
        `campaign-blocked:${countryPolicyReason}`, 409, occurredAt);
      return { status: "blocked" as const, reasonCode: countryPolicyReason };
    }
    const result = await this.session.query<CampaignRow>(`
      UPDATE enterprise.marketing_campaigns
      SET status = 'scheduled', updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4
        AND status = 'approved' AND approval_status = 'approved'
      RETURNING *
    `, [uuid(input.campaignId), occurredAt, input.expectedVersion]);
    if (!result.rows[0]) return { status: "conflict" as const };
    const campaign = mapCampaign(result.rows[0]);
    await this.recordMutation({ ...input, route: "campaign.schedule", campaign });
    return { status: "scheduled" as const, campaign };
  }

  private async replayMutation(input: MutationCommandInput) {
    const actorId = enterprisePostgresActorSubjectId(this.session.context.actorUserId);
    await this.session.query(`
      SELECT pg_advisory_xact_lock(hashtextextended(
        $1::text || ':' || $2 || ':' || $3 || ':' || $4, 0))
      FROM (SELECT $1::text AS tenant_id) AS command_scope
      WHERE tenant_id = $1
    `, [actorId, input.route, eventKey(input.idempotencyKey)]);
    const result = await this.session.query<CampaignCommandRow>(`
      SELECT actor_id, route, idempotency_key, request_hash, resource_id,
        response_body_ref
      FROM enterprise.idempotency_keys
      WHERE tenant_id = $1 AND actor_id = $2 AND route = $3
        AND idempotency_key = $4
    `, [actorId, input.route, eventKey(input.idempotencyKey)]);
    const command = result.rows[0];
    if (!command) return null;
    if (command.request_hash !== hash(input.requestHash) ||
      command.resource_id !== uuid(input.campaignId)) {
      return { status: "idempotency_conflict" as const };
    }
    const blocked = blockedResult(command.response_body_ref);
    if (blocked) return { status: "blocked" as const, reasonCode: blocked,
      replayed: true as const };
    const expected = commandResult(command.response_body_ref);
    const campaign = await this.find(input.campaignId, true);
    if (!campaign) return { status: "not_found" as const };
    return expected && campaign.version === expected.version &&
      campaign.status === expected.status
      ? { status: "replayed" as const, campaign }
      : { status: "conflict" as const };
  }

  private async recordMutation(input: MutationCommandInput & {
    campaign: EnterpriseCampaignRecord;
  }) {
    const createdAt = iso(input.campaign.updatedAt);
    await this.recordCommand(input, commandResultRef(input.campaign), 200, createdAt);
  }

  private async recordCommand(input: MutationCommandInput, resultRef: string,
    responseCode: number, createdAt: string) {
    const expiresAt = new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1_000)
      .toISOString();
    await this.session.query(`
      INSERT INTO enterprise.idempotency_keys(
        tenant_id, actor_id, route, idempotency_key, request_hash, status,
        response_code, response_body_ref, resource_id, created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10)
    `, [enterprisePostgresActorSubjectId(this.session.context.actorUserId), input.route,
      eventKey(input.idempotencyKey), hash(input.requestHash),
      responseCode, resultRef, uuid(input.campaignId), iso(createdAt), expiresAt]);
  }
}

interface MutationCommandInput {
  campaignId: string; expectedVersion: number;
  idempotencyKey: string; requestHash: string;
  route: "campaign.draft_update" | "campaign.schedule";
}

interface CampaignCommandRow extends Record<string, unknown> {
  actor_id: string; route: string; idempotency_key: string; request_hash: string;
  resource_id: string | null; response_body_ref: string | null;
}

interface CampaignRow extends Record<string, unknown> {
  id: string; tenant_id: string; name: string; objective: string;
  owner_user_id: string; country_codes: string[]; language_codes: string[];
  status: EnterpriseCampaignRecord["status"];
  approval_status: EnterpriseCampaignRecord["approvalStatus"];
  approval_snapshot_id: string | null; policy_version: string | null;
  schedule: EnterpriseCampaignScheduleDto;
  concurrency_limit: number; created_at: string | Date; updated_at: string | Date;
  version: string | number; creation_key: string; creation_request_hash: string;
}
function mapCampaign(row: CampaignRow): EnterpriseCampaignRecord {
  if (!["draft", "validating", "pending_approval", "approved", "scheduled",
    "running", "paused", "completed", "cancelled", "failed"].includes(row.status) ||
    !["not_submitted", "pending", "approved", "rejected", "expired"]
      .includes(row.approval_status)) throw new Error("Invalid campaign state");
  const content = campaignContent({ name: row.name, objective: row.objective,
    countryCodes: row.country_codes, languageCodes: row.language_codes,
    schedule: row.schedule, concurrencyLimit: row.concurrency_limit });
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id),
    name: content.name, objective: content.objective,
    ownerUserId: enterprisePostgresAccountSubjectId(row.owner_user_id),
    countryCodes: content.countryCodes, languageCodes: content.languageCodes,
    status: row.status, approvalStatus: row.approval_status,
    ...(row.approval_snapshot_id
      ? { approvalSnapshotId: uuid(row.approval_snapshot_id) } : {}),
    ...(row.policy_version ? { policyVersion: row.policy_version } : {}),
    schedule: content.schedule, concurrencyLimit: content.concurrencyLimit,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    version: Number(row.version) };
}
function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
    throw new Error("Invalid campaign UUID");
  return value;
}
function bounded(value: unknown, max: number) {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 ||
    Buffer.byteLength(value) > max) throw new Error("Invalid campaign text");
  return value;
}
function eventKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value))
    throw new Error("Invalid campaign idempotency key");
  return value;
}
function hash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid campaign request hash");
  return value;
}
function commandResultRef(campaign: EnterpriseCampaignRecord) {
  return `campaign:v${campaign.version}:${campaign.status}`;
}
function commandResult(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^campaign:v([1-9][0-9]*):([a-z_]+)$/.exec(value);
  const version = Number(match?.[1]);
  const status = match?.[2] as EnterpriseCampaignRecord["status"] | undefined;
  return match && Number.isSafeInteger(version) && version > 0 && status &&
    ["draft", "validating", "pending_approval", "approved", "scheduled", "running",
      "paused", "completed", "cancelled", "failed"].includes(status)
    ? { version, status } : null;
}
function blockedResult(value: unknown) {
  if (typeof value !== "string") return null;
  const reason = value.startsWith("campaign-blocked:")
    ? value.slice("campaign-blocked:".length) : "";
  return ["approval_required", "policy_version_required", "schedule_start_required",
    "schedule_start_elapsed", "status_not_schedulable", "country_policy_missing",
    "country_policy_not_yet_effective", "country_policy_expired",
    "approval_snapshot_required", "approval_snapshot_stale"].includes(reason)
    ? reason as ReturnType<typeof campaignScheduleBlock> : null;
}
function iso(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : value;
  if (typeof text !== "string" || new Date(text).toISOString() !== text)
    throw new Error("Invalid campaign timestamp");
  return text;
}
function nextIso(value: unknown, after: string) {
  const candidate = iso(value);
  return candidate > after ? candidate
    : new Date(Date.parse(after) + 1).toISOString();
}
function campaignContent(input: { name: unknown; objective: unknown;
  countryCodes: unknown; languageCodes: unknown; schedule: unknown;
  concurrencyLimit: unknown }) {
  const countryCodes = codeArray(input.countryCodes, /^[A-Z]{2}$/);
  const languageCodes = codeArray(input.languageCodes,
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
  const schedule = scheduleValue(input.schedule);
  if (!countryCodes || !languageCodes || !schedule ||
    typeof input.concurrencyLimit !== "number" ||
    !Number.isSafeInteger(input.concurrencyLimit) || input.concurrencyLimit < 1 ||
    input.concurrencyLimit > 100) throw new Error("Invalid campaign content");
  return { name: bounded(input.name, 200), objective: bounded(input.objective, 2_000),
    countryCodes, languageCodes, schedule,
    concurrencyLimit: input.concurrencyLimit };
}
function codeArray(value: unknown, pattern: RegExp) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32 ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length) return null;
  return [...value] as string[];
}
function scheduleValue(value: unknown): EnterpriseCampaignScheduleDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !["timezone", "startAt", "endAt"].includes(key)) ||
    typeof item.timezone !== "string" || item.timezone !== item.timezone.trim() ||
    !item.timezone || item.timezone.length > 64) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: item.timezone }).format(); }
  catch { return null; }
  const startAt = item.startAt === undefined ? undefined : safeIso(item.startAt);
  const endAt = item.endAt === undefined ? undefined : safeIso(item.endAt);
  if (startAt === null || endAt === null || startAt && endAt && endAt <= startAt) return null;
  return { timezone: item.timezone, ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}) };
}
function safeIso(value: unknown) {
  if (typeof value !== "string") return null; const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : null;
}
