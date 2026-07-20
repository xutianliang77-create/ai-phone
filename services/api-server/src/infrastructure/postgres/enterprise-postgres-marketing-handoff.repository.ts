import type { EnterpriseMarketingAgentRunRecord } from
  "../../modules/enterprise/enterprise-marketing-agent.js";
import type {
  EnterpriseMarketingHandoffPolicyRecord,
  EnterpriseMarketingHandoffRecord,
} from "../../modules/enterprise/enterprise-marketing-handoff.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMarketingHandoffPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async findPolicy(campaignId: string, lock = false) {
    const result = await this.session.query<PolicyRow>(`
      SELECT * FROM enterprise.marketing_handoff_policies
      WHERE tenant_id = $1 AND campaign_id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(campaignId)]);
    return result.rows[0] ? mapPolicy(result.rows[0]) : null;
  }

  async upsertPolicy(input: { id: string; campaignId: string;
    supportQueueId: string; supportChannelId: string; timeoutSeconds: number;
    timeoutAction: "end_call" | "callback"; callbackDelaySeconds?: number;
    expectedVersion?: number; idempotencyKey: string; requestHash: string;
    occurredAt: string }) {
    const current = await this.findPolicy(input.campaignId, true);
    if (current?.lastCommandKey === key(input.idempotencyKey)) {
      return current.lastCommandHash === hash(input.requestHash)
        ? { status: "replayed" as const, policy: current }
        : { status: "idempotency_conflict" as const };
    }
    const command = values(input);
    if (!current) {
      if (input.expectedVersion !== undefined) return { status: "version_conflict" as const };
      const result = await this.session.query<PolicyRow>(`
        INSERT INTO enterprise.marketing_handoff_policies(
          tenant_id, id, campaign_id, support_queue_id, support_channel_id,
          timeout_seconds, timeout_action, callback_delay_seconds, created_by,
          creation_key, creation_request_hash, last_command_key, last_command_hash,
          created_at, updated_at, version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$11,$12,$12,1)
        RETURNING *
      `, [uuid(input.id), uuid(input.campaignId), command.supportQueueId,
        command.supportChannelId, command.timeoutSeconds, command.timeoutAction,
        command.callbackDelaySeconds ?? null, this.session.context.actorUserId,
        key(input.idempotencyKey), hash(input.requestHash), iso(input.occurredAt)]);
      return { status: "created" as const, policy: mapPolicy(result.rows[0]!) };
    }
    if (current.version !== input.expectedVersion) {
      return { status: "version_conflict" as const };
    }
    const result = await this.session.query<PolicyRow>(`
      UPDATE enterprise.marketing_handoff_policies SET support_queue_id = $3,
        support_channel_id = $4, timeout_seconds = $5, timeout_action = $6,
        callback_delay_seconds = $7, last_command_key = $8,
        last_command_hash = $9, updated_at = $10, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $11 RETURNING *
    `, [current.id, command.supportQueueId, command.supportChannelId,
      command.timeoutSeconds, command.timeoutAction,
      command.callbackDelaySeconds ?? null, key(input.idempotencyKey),
      hash(input.requestHash), iso(input.occurredAt), current.version]);
    return result.rows[0]
      ? { status: "updated" as const, policy: mapPolicy(result.rows[0]) }
      : { status: "version_conflict" as const };
  }

  async findLeadContact(leadId: string) {
    const result = await this.session.query<LeadRow>(`
      SELECT id, phone_hash, phone_hint, language
      FROM enterprise.marketing_leads WHERE tenant_id = $1 AND id = $2
    `, [uuid(leadId)]);
    const row = result.rows[0];
    return row ? { id: uuid(row.id), phoneHash: hash(row.phone_hash),
      phoneHint: bounded(row.phone_hint, 64),
      ...(row.language ? { locale: locale(row.language) } : {}) } : null;
  }

  async create(input: { id: string; run: EnterpriseMarketingAgentRunRecord;
    supportSessionId: string; policy: EnterpriseMarketingHandoffPolicyRecord;
    aiFencedAt: string }) {
    const prior = await this.findByRun(input.run.id, true);
    if (prior) return { status: "replayed" as const, handoff: prior };
    const timeoutAt = new Date(Date.parse(iso(input.aiFencedAt)) +
      input.policy.timeoutSeconds * 1_000).toISOString();
    const result = await this.session.query<HandoffRow>(`
      INSERT INTO enterprise.marketing_handoffs(
        tenant_id, id, marketing_agent_run_id, dispatch_id, campaign_id, lead_id,
        communication_session_id, support_session_id, support_queue_id,
        support_channel_id, policy_id, policy_version, timeout_action,
        callback_delay_seconds, status, ai_fenced_at, timeout_at,
        created_at, updated_at, version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        'queued',$15,$16,$15,$15,1) RETURNING *
    `, [uuid(input.id), uuid(input.run.id), uuid(input.run.dispatchId),
      uuid(input.run.campaignId), uuid(input.run.leadId),
      bounded(input.run.communicationSessionId, 160), uuid(input.supportSessionId),
      uuid(input.policy.supportQueueId), uuid(input.policy.supportChannelId),
      uuid(input.policy.id), positive(input.policy.version), input.policy.timeoutAction,
      input.policy.callbackDelaySeconds ?? null, iso(input.aiFencedAt), timeoutAt]);
    return { status: "created" as const, handoff: mapHandoff(result.rows[0]!) };
  }

  findByRun(runId: string, lock = false) {
    return this.find("marketing_agent_run_id", runId, lock);
  }
  findBySupportSession(sessionId: string, lock = false) {
    return this.find("support_session_id", sessionId, lock);
  }
  findByDispatch(dispatchId: string) { return this.find("dispatch_id", dispatchId, false); }

  async recordMedia(input: { handoffId: string; requestedAt: string;
    result: { status: "active"; aiAudioStoppedAt: string; operatorJoinedAt: string;
      providerFingerprint: string; receiptHash: string } |
      { status: "media_not_ready" | "failed";
      reasonCode: string } }) {
    const current = await this.find("id", input.handoffId, true);
    if (!current) return { status: "not_found" as const };
    if (current.status === "active") return { status: "replayed" as const,
      handoff: current };
    if (!["queued", "media_not_ready"].includes(current.status)) {
      return { status: "conflict" as const };
    }
    const aiAudioStoppedAt = input.result.status === "active"
      ? iso(input.result.aiAudioStoppedAt) : null;
    const completedAt = input.result.status === "active"
      ? iso(input.result.operatorJoinedAt) : null;
    const providerFingerprint = input.result.status === "active"
      ? code(input.result.providerFingerprint, 200) : null;
    const receiptHash = input.result.status === "active"
      ? hash(input.result.receiptHash) : null;
    const failureCode = input.result.status === "active"
      ? null : failure(input.result.reasonCode);
    const result = await this.session.query<HandoffRow>(`
      UPDATE enterprise.marketing_handoffs SET status = $3,
        media_requested_at = $4, media_ai_stopped_at = $5,
        media_completed_at = $6, provider_fingerprint = $7,
        provider_receipt_hash = $8, failure_code = $9,
        updated_at = $10, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $11 RETURNING *
    `, [current.id, input.result.status, iso(input.requestedAt),
      aiAudioStoppedAt, completedAt, providerFingerprint, receiptHash, failureCode,
      completedAt ?? iso(input.requestedAt),
      current.version]);
    return result.rows[0] ? { status: "updated" as const,
      handoff: mapHandoff(result.rows[0]) } : { status: "conflict" as const };
  }

  async listDue(now: string, limit: number) {
    const result = await this.session.query<DueRow>(`
      SELECT handoff.*, session_record.version AS support_session_version
      FROM enterprise.marketing_handoffs handoff
      JOIN enterprise.support_sessions session_record
        ON session_record.tenant_id = handoff.tenant_id
        AND session_record.id = handoff.support_session_id
      LEFT JOIN enterprise.support_agent_claims claim
        ON claim.tenant_id = session_record.tenant_id
        AND claim.id = session_record.active_agent_claim_id AND claim.status = 'active'
      WHERE handoff.tenant_id = $1
        AND handoff.status IN ('queued', 'media_not_ready')
        AND handoff.timeout_at <= $2::timestamptz
        AND session_record.status = 'handoff_requested' AND claim.id IS NULL
      ORDER BY handoff.timeout_at, handoff.id
      LIMIT $3 FOR UPDATE OF session_record SKIP LOCKED
    `, [iso(now), integer(limit, 1, 100)]);
    return result.rows.map((row) => ({ handoff: mapHandoff(row),
      supportSessionVersion: positive(row.support_session_version) }));
  }

  async recordTimeout(handoffId: string, action: "end_call" | "callback", now: string) {
    const current = await this.find("id", handoffId, true);
    if (!current || !["queued", "media_not_ready"].includes(current.status)) return null;
    const status = action === "callback" ? "callback_required" : "timed_out";
    const failureCode = action === "callback"
      ? "marketing_handoff_callback_required" : "marketing_handoff_timeout";
    const result = await this.session.query<HandoffRow>(`
      UPDATE enterprise.marketing_handoffs SET status = $3, failure_code = $4,
        updated_at = $5, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $6 RETURNING *
    `, [current.id, status, failureCode, iso(now), current.version]);
    return result.rows[0] ? mapHandoff(result.rows[0]) : null;
  }

  private async find(column: "id" | "marketing_agent_run_id" |
    "support_session_id" | "dispatch_id", id: string, lock: boolean) {
    const result = await this.session.query<HandoffRow>(`
      SELECT * FROM enterprise.marketing_handoffs
      WHERE tenant_id = $1 AND ${column} = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(id)]);
    return result.rows[0] ? mapHandoff(result.rows[0]) : null;
  }
}

interface PolicyRow extends Record<string, unknown> { id: string; tenant_id: string;
  campaign_id: string; support_queue_id: string; support_channel_id: string;
  timeout_seconds: number | string; timeout_action: string;
  callback_delay_seconds: number | string | null; created_by: string;
  creation_key: string; creation_request_hash: string; last_command_key: string;
  last_command_hash: string; created_at: string | Date; updated_at: string | Date;
  version: number | string; }
interface HandoffRow extends Record<string, unknown> { id: string; tenant_id: string;
  marketing_agent_run_id: string; dispatch_id: string; campaign_id: string; lead_id: string;
  communication_session_id: string; support_session_id: string; support_queue_id: string;
  support_channel_id: string; policy_id: string; policy_version: number | string;
  timeout_action: string; callback_delay_seconds: number | string | null; status: string;
  ai_fenced_at: string | Date; timeout_at: string | Date;
  media_requested_at: string | Date | null;
  media_ai_stopped_at: string | Date | null;
  media_completed_at: string | Date | null;
  provider_fingerprint: string | null; provider_receipt_hash: string | null;
  failure_code: string | null; created_at: string | Date; updated_at: string | Date;
  version: number | string; }
interface DueRow extends HandoffRow { support_session_version: number | string; }
interface LeadRow extends Record<string, unknown> { id: string; phone_hash: string;
  phone_hint: string; language: string | null; }

function mapPolicy(row: PolicyRow): EnterpriseMarketingHandoffPolicyRecord {
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), campaignId: uuid(row.campaign_id),
    supportQueueId: uuid(row.support_queue_id), supportChannelId: uuid(row.support_channel_id),
    timeoutSeconds: positive(row.timeout_seconds), timeoutAction: action(row.timeout_action),
    ...(row.callback_delay_seconds ? { callbackDelaySeconds: positive(row.callback_delay_seconds) } : {}),
    createdBy: bounded(row.created_by, 200), creationKey: key(row.creation_key),
    creationRequestHash: hash(row.creation_request_hash), lastCommandKey: key(row.last_command_key),
    lastCommandHash: hash(row.last_command_hash), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), version: positive(row.version) };
}
function mapHandoff(row: HandoffRow): EnterpriseMarketingHandoffRecord {
  const status = row.status as EnterpriseMarketingHandoffRecord["status"];
  if (!["queued", "media_not_ready", "active", "timed_out", "callback_required",
    "failed", "completed"].includes(status)) throw new Error("Invalid handoff status");
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id),
    marketingAgentRunId: uuid(row.marketing_agent_run_id), dispatchId: uuid(row.dispatch_id),
    campaignId: uuid(row.campaign_id), leadId: uuid(row.lead_id),
    communicationSessionId: bounded(row.communication_session_id, 160),
    supportSessionId: uuid(row.support_session_id), supportQueueId: uuid(row.support_queue_id),
    supportChannelId: uuid(row.support_channel_id), policyId: uuid(row.policy_id),
    policyVersion: positive(row.policy_version), timeoutAction: action(row.timeout_action),
    ...(row.callback_delay_seconds ? { callbackDelaySeconds: positive(row.callback_delay_seconds) } : {}),
    status, aiFencedAt: iso(row.ai_fenced_at), timeoutAt: iso(row.timeout_at),
    ...(row.media_requested_at ? { mediaRequestedAt: iso(row.media_requested_at) } : {}),
    ...(row.media_ai_stopped_at
      ? { mediaAiAudioStoppedAt: iso(row.media_ai_stopped_at) } : {}),
    ...(row.media_completed_at ? { mediaCompletedAt: iso(row.media_completed_at) } : {}),
    ...(row.provider_fingerprint ? { providerFingerprint: code(row.provider_fingerprint, 200) } : {}),
    ...(row.provider_receipt_hash ? { providerReceiptHash: hash(row.provider_receipt_hash) } : {}),
    ...(row.failure_code ? { failureCode: failure(row.failure_code) } : {}),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), version: positive(row.version) };
}
function values(input: Parameters<EnterpriseMarketingHandoffPostgresRepository["upsertPolicy"]>[0]) {
  const timeoutSeconds = integer(input.timeoutSeconds, 10, 86_400);
  const callbackDelaySeconds = input.timeoutAction === "callback"
    ? integer(input.callbackDelaySeconds, 60, 604_800) : undefined;
  if (!timeoutSeconds || input.timeoutAction === "callback" && !callbackDelaySeconds ||
    input.timeoutAction === "end_call" && input.callbackDelaySeconds !== undefined) {
    throw new Error("Invalid marketing handoff policy");
  }
  return { supportQueueId: uuid(input.supportQueueId),
    supportChannelId: uuid(input.supportChannelId), timeoutSeconds,
    timeoutAction: action(input.timeoutAction), callbackDelaySeconds };
}
function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid handoff UUID"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid handoff hash"); return value; }
function key(value: unknown) { return code(value, 160); }
function code(value: unknown, max: number) { if (typeof value !== "string" || Buffer.byteLength(value) > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error("Invalid handoff code"); return value; }
function failure(value: unknown) { if (typeof value !== "string" || !/^[a-z][a-z0-9_]{1,79}$/.test(value)) throw new Error("Invalid handoff failure"); return value; }
function bounded(value: unknown, max: number) { if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max) throw new Error("Invalid handoff text"); return value; }
function locale(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) throw new Error("Invalid handoff locale"); return value; }
function positive(value: unknown) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid handoff number"); return result; }
function integer(value: unknown, min: number, max: number) { return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null; }
function action(value: unknown) { if (value !== "end_call" && value !== "callback") throw new Error("Invalid handoff action"); return value; }
function iso(value: unknown) { const result = value instanceof Date ? value.toISOString() : value; if (typeof result !== "string" || new Date(result).toISOString() !== result) throw new Error("Invalid handoff time"); return result; }
