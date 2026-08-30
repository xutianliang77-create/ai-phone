import { randomUUID } from "node:crypto";
import type { EnterpriseMarketingPstnDispatchCounts } from
  "@translation/contracts";
import { openEnterpriseLeadPhone, type EnterpriseLeadPhoneKeyring } from
  "../../modules/enterprise/enterprise-lead-phone.js";
import {
  emptyMarketingPstnDispatchCounts,
  marketingPstnIdempotencyKey,
  marketingPstnIdentity,
  marketingPstnRequestHash,
  type EnterpriseMarketingPstnCallRequest,
  type EnterpriseMarketingPstnDispatchRecord,
} from "../../modules/enterprise/enterprise-marketing-pstn.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { ensureMarketingPstnBinding, marketingPstnSafetyFenceIsCurrent } from
  "./enterprise-postgres-marketing-pstn-binding.js";
import { EnterpriseTenantAdmissionPostgresRepository } from
  "./enterprise-postgres-tenant-admission.js";
import { marketingAdmissionId, marketingAdmissionOwner } from
  "./enterprise-postgres-marketing-admission.js";
import { code, count, errorCode, eventKey, hash, iso, language, mapDispatch,
  positive, sameFence, uuid, validClaim, type CountRow, type DispatchRow,
  type TaskRow } from
  "./enterprise-postgres-marketing-pstn-record.js";

export class EnterpriseMarketingPstnPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async counts(campaignId: string): Promise<EnterpriseMarketingPstnDispatchCounts> {
    const result = await this.session.query<CountRow>(`
      SELECT count(*)::text AS total,
        count(*) FILTER (WHERE status = 'prepared')::text AS prepared,
        count(*) FILTER (WHERE status = 'unknown')::text AS unknown,
        count(*) FILTER (WHERE status = 'accepted')::text AS accepted,
        count(*) FILTER (WHERE status = 'answered')::text AS answered,
        count(*) FILTER (WHERE status = 'completed')::text AS completed,
        count(*) FILTER (WHERE status = 'failed')::text AS failed
      FROM enterprise.marketing_pstn_dispatches
      WHERE tenant_id = $1 AND campaign_id = $2
    `, [uuid(campaignId)]);
    const row = result.rows[0];
    if (!row) return emptyMarketingPstnDispatchCounts();
    return { total: count(row.total), prepared: count(row.prepared),
      unknown: count(row.unknown), accepted: count(row.accepted),
      answered: count(row.answered), completed: count(row.completed),
      failed: count(row.failed) };
  }

  async prepare(input: {
    taskId: string;
    generation: number;
    claimToken: string;
    homeRegion: string;
    cellId: string;
    routeEpoch: number;
    provider: "pstn_http" | "pstn_fonoster";
    providerFingerprint: string;
    enterpriseAgent: EnterpriseMarketingPstnCallRequest["enterpriseAgent"];
    keyring: EnterpriseLeadPhoneKeyring;
    now: string;
  }) {
    const task = await this.lockTask(input.taskId);
    if (!task) return { status: "not_found" as const };
    const replay = await this.find(task.id, input.generation);
    if (replay) {
      if (!sameFence(replay, input, task)) return { status: "conflict" as const };
      if (["accepted", "answered", "completed"].includes(replay.status)) {
        return { status: "already_accepted" as const, dispatch: replay };
      }
      if (replay.status === "failed") return { status: "claim_rejected" as const };
      return { status: "prepared" as const, dispatch: replay,
        request: this.callRequest(task, replay, input.keyring, input.enterpriseAgent) };
    }
    if (!validClaim(task, input)) return { status: "claim_rejected" as const };
    const admitted = await new EnterpriseTenantAdmissionPostgresRepository(
      this.session,
    ).active({ capability: "marketing_pstn",
      grantId: marketingAdmissionId(task.tenant_id, task.id, input.generation),
      workerId: marketingAdmissionOwner(task.id), now: input.now });
    if (!admitted) return { status: "claim_rejected" as const };
    if (!await marketingPstnSafetyFenceIsCurrent(this.session, task, input.now)) {
      return { status: "policy_rejected" as const };
    }
    const policy = await this.session.query<{ policy_version: string }>(`
      SELECT policy_version FROM enterprise.communication_policy_versions
      WHERE tenant_id = $1 AND status = 'published' AND published_at <= $2
      ORDER BY published_at DESC, id DESC LIMIT 1
    `, [iso(input.now)]);
    if (!policy.rows[0]) return { status: "policy_rejected" as const };
    const bindingId = marketingPstnIdentity({ kind: "binding",
      tenantId: task.tenant_id, taskId: task.id, generation: 1 });
    const sessionId = marketingPstnIdentity({ kind: "session",
      tenantId: task.tenant_id, taskId: task.id, generation: 1 });
    const dispatchId = marketingPstnIdentity({ kind: "dispatch",
      tenantId: task.tenant_id, taskId: task.id, generation: input.generation });
    const idempotencyKey = marketingPstnIdempotencyKey({ tenantId: task.tenant_id,
      taskId: task.id, generation: input.generation });
    const requestHash = marketingPstnRequestHash({ taskId: task.id,
      generation: input.generation, phoneHash: task.phone_hash,
      objective: task.objective, language: language(task),
      policyVersionId: task.country_policy_version_id });
    const binding = await ensureMarketingPstnBinding(this.session, { bindingId,
      sessionId, task, homeRegion: input.homeRegion, cellId: input.cellId,
      routeEpoch: input.routeEpoch, generation: input.generation, now: input.now,
      policyVersion: policy.rows[0].policy_version });
    if (!binding) return { status: "conflict" as const };
    const outboxEventId = randomUUID();
    await this.session.query(`
      INSERT INTO enterprise.outbox_events(
        tenant_id, id, aggregate_type, aggregate_id, event_type,
        idempotency_key, payload, trace_id, attempts, available_at, created_at
      ) VALUES ($1, $2, 'marketing_pstn_dispatch', $3,
        'marketing.pstn.dispatch.requested', $4, $5::jsonb, $6, 0, $7, $8)
    `, [outboxEventId, uuid(dispatchId), eventKey(`marketing.pstn:${dispatchId}`),
      JSON.stringify({ dispatchId, taskId: task.id, campaignId: task.campaign_id,
        communicationSessionId: sessionId, dispatchGeneration: input.generation,
        routeEpoch: input.routeEpoch }), this.session.context.traceId,
      task.lease_expires_at, iso(input.now)]);
    const inserted = await this.session.query<DispatchRow>(`
      INSERT INTO enterprise.marketing_pstn_dispatches(
        tenant_id, id, task_id, campaign_id, communication_session_id,
        communication_binding_id, usage_hold_id, outbox_event_id,
        dispatch_generation, route_epoch, home_region, cell_id, provider,
        provider_fingerprint, provider_idempotency_key, request_hash, status,
        prepared_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, 'prepared', $17, $17, 1)
      RETURNING *
    `, [uuid(dispatchId), uuid(task.id), uuid(task.campaign_id), sessionId,
      uuid(bindingId), uuid(task.usage_hold_id), outboxEventId, input.generation,
      input.routeEpoch, code(input.homeRegion, 64), code(input.cellId, 64),
      input.provider, hash(input.providerFingerprint), eventKey(idempotencyKey),
      hash(requestHash), iso(input.now)]);
    const dispatch = mapDispatch(inserted.rows[0]!);
    return { status: "prepared" as const, dispatch,
      request: this.callRequest(task, dispatch, input.keyring, input.enterpriseAgent) };
  }

  async providerResult(input: { dispatchId: string;
    result: "accepted" | "unknown" | "failed"; providerCallId?: string;
    failureCode?: string; now: string }) {
    const terminal = input.result === "failed";
    const result = await this.session.query<DispatchRow>(`
      UPDATE enterprise.marketing_pstn_dispatches
      SET status = $3, provider_call_id = COALESCE($4, provider_call_id),
        failure_code = $5, accepted_at = CASE WHEN $3 = 'accepted' THEN $6
          ELSE accepted_at END,
        ended_at = CASE WHEN $3 = 'failed' THEN $6 ELSE ended_at END,
        updated_at = GREATEST($6::timestamptz,
          updated_at + interval '1 millisecond'), version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status IN ('prepared', 'unknown')
      RETURNING *
    `, [uuid(input.dispatchId), input.result, input.providerCallId ?? null,
      input.failureCode ? errorCode(input.failureCode) :
        terminal ? "provider_rejected" : null,
      iso(input.now)]);
    if (result.rows[0]) return mapDispatch(result.rows[0]);
    return this.findById(input.dispatchId);
  }

  async acceptTask(dispatch: EnterpriseMarketingPstnDispatchRecord, now: string) {
    const result = await this.session.query<{ id: string }>(`
      UPDATE enterprise.marketing_call_tasks
      SET status = 'dispatched', outcome_code = NULL, claimed_at = NULL,
        claim_owner = NULL, claim_token_hash = NULL, lease_expires_at = NULL,
        updated_at = GREATEST($3::timestamptz,
          updated_at + interval '1 millisecond'), version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'dispatching'
        AND dispatch_generation = $4 AND usage_hold_id = $5
      RETURNING id
    `, [uuid(dispatch.taskId), iso(now), dispatch.dispatchGeneration,
      uuid(dispatch.usageHoldId)]);
    return Boolean(result.rows[0]);
  }

  async releaseFailedHold(dispatch: EnterpriseMarketingPstnDispatchRecord, now: string) {
    await this.session.query(`
      UPDATE enterprise.usage_holds SET status = 'released', released_at = $3,
        updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'held'
      RETURNING id
    `, [uuid(dispatch.usageHoldId), iso(now)]);
  }

  async markOutbox(dispatch: EnterpriseMarketingPstnDispatchRecord,
    input: { publishedAt?: string; errorCode?: string; availableAt: string }) {
    await this.session.query(`
      UPDATE enterprise.outbox_events SET published_at = $3,
        last_error_code = $4, available_at = $5, lease_expires_at = NULL
      WHERE tenant_id = $1 AND id = $2 AND published_at IS NULL
      RETURNING id
    `, [uuid(dispatch.outboxEventId), input.publishedAt ?? null,
      input.errorCode ? errorCode(input.errorCode) : null, iso(input.availableAt)]);
  }

  async findById(id: string) {
    const result = await this.session.query<DispatchRow>(`
      SELECT * FROM enterprise.marketing_pstn_dispatches
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [uuid(id)]);
    return result.rows[0] ? mapDispatch(result.rows[0]) : null;
  }

  async findByFence(taskId: string, generation: number) {
    return this.find(taskId, generation);
  }

  async applyWebhook(input: { dispatchId: string; eventId: string;
    status: "in_progress" | "completed" | "failed";
    providerCallId?: string; failureCode?: string; now: string }) {
    const current = await this.findById(input.dispatchId);
    if (!current) return null;
    const next = input.status === "in_progress" ? "answered" : input.status;
    if (["completed", "failed"].includes(current.status)) return current;
    if (next === "answered" && current.status === "answered") return current;
    const result = await this.session.query<DispatchRow>(`
      UPDATE enterprise.marketing_pstn_dispatches
      SET status = $3, provider_call_id = COALESCE(provider_call_id, $4),
        last_provider_event_id = $5,
        answered_at = CASE WHEN $3 = 'answered' THEN $6 ELSE answered_at END,
        ended_at = CASE WHEN $3 IN ('completed', 'failed') THEN $6 ELSE ended_at END,
        failure_code = CASE WHEN $3 = 'failed' THEN $7 ELSE failure_code END,
        updated_at = GREATEST($6::timestamptz,
          updated_at + interval '1 millisecond'), version = version + 1
      WHERE tenant_id = $1 AND id = $2
        AND status IN ('accepted', 'answered') RETURNING *
    `, [uuid(input.dispatchId), next, input.providerCallId ?? null,
      eventKey(input.eventId), iso(input.now), input.status === "failed"
        ? errorCode(input.failureCode ?? "provider_failed") : null]);
    const updated = result.rows[0] ? mapDispatch(result.rows[0]) : null;
    if (!updated) return current;
    const taskStatus = next === "answered" ? "answered" : next;
    const outcome = next === "completed" ? "provider_completed" :
      next === "failed" ? "provider_failed" : null;
    const task = await this.session.query<{ id: string }>(`
      UPDATE enterprise.marketing_call_tasks
      SET status = $3, outcome_code = $4,
        updated_at = GREATEST($5::timestamptz,
          updated_at + interval '1 millisecond'),
        version = version + 1
      WHERE tenant_id = $1 AND id = $2
        AND status IN ('dispatched', 'answered') RETURNING id
    `, [uuid(updated.taskId), taskStatus, outcome, iso(input.now)]);
    if (!task.rows[0]) throw new Error("Marketing PSTN task transition conflict");
    return updated;
  }

  private async find(taskId: string, generation: number) {
    const result = await this.session.query<DispatchRow>(`
      SELECT * FROM enterprise.marketing_pstn_dispatches
      WHERE tenant_id = $1 AND task_id = $2 AND dispatch_generation = $3
      FOR UPDATE
    `, [uuid(taskId), positive(generation)]);
    return result.rows[0] ? mapDispatch(result.rows[0]) : null;
  }

  private async lockTask(taskId: string) {
    const result = await this.session.query<TaskRow>(`
      SELECT task.*, campaign.objective, campaign.language_codes,
        lead.external_id, lead.phone_e164_encrypted, lead.phone_hash, lead.language
      FROM enterprise.marketing_call_tasks task
      JOIN enterprise.marketing_campaigns campaign
        ON campaign.tenant_id = task.tenant_id AND campaign.id = task.campaign_id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = task.tenant_id AND lead.id = task.lead_id
      WHERE task.tenant_id = $1 AND task.id = $2 FOR UPDATE OF task
    `, [uuid(taskId)]);
    return result.rows[0] ?? null;
  }

  private callRequest(task: TaskRow, dispatch: EnterpriseMarketingPstnDispatchRecord,
    keyring: EnterpriseLeadPhoneKeyring,
    enterpriseAgent: EnterpriseMarketingPstnCallRequest["enterpriseAgent"]):
    EnterpriseMarketingPstnCallRequest {
    return { idempotencyKey: dispatch.providerIdempotencyKey, draftId: task.id,
      callId: dispatch.communicationSessionId,
      targetPhone: openEnterpriseLeadPhone({ tenantId: task.tenant_id, id: task.lead_id,
        field: "e164", encrypted: task.phone_e164_encrypted, keyring }),
      objective: task.objective, suggestedScript: task.objective,
      language: language(task), consentPromptVersion: task.country_policy_version_id,
      enterpriseAgent,
      enterpriseContext: { tenantId: dispatch.tenantId,
        homeRegion: dispatch.homeRegion, cellId: dispatch.cellId,
        routeEpoch: dispatch.routeEpoch, taskId: dispatch.taskId,
        dispatchGeneration: dispatch.dispatchGeneration } };
  }
}
