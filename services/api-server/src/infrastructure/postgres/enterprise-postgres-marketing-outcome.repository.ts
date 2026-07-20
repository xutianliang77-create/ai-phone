import type {
  EnterpriseMarketingDisposition,
  EnterpriseMarketingIntentLevel,
  EnterpriseMarketingNextActionKind,
  EnterpriseMarketingOutcomeEvidenceRef,
} from "@translation/contracts";
import {
  enterpriseMarketingOutcomeHash,
  validEnterpriseMarketingOutcomeCombination,
} from "../../modules/enterprise/enterprise-marketing-outcome.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  actor, contentHash, count, eligible, hash, id, integer, iso, key, mapOutcome,
  number, selectOutcome, summary, systemEvidence, terminalEvidence, uuid, validateDueAt,
  type CallEvidenceRow, type CreateOutcomeInput, type Evidence, type OutcomeRow,
  type TranscriptRow, type TurnRow,
} from "./enterprise-postgres-marketing-outcome-record.js";

export class EnterpriseMarketingOutcomePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async list(campaignId: string, limit = 100) {
    const result = await this.session.query<OutcomeRow>(`${selectOutcome}
      WHERE outcome.tenant_id = $1 AND outcome.campaign_id = $2
        AND outcome.evidence_status = 'verified'
      ORDER BY outcome.created_at DESC, outcome.id DESC LIMIT $3
    `, [uuid(campaignId), integer(limit, 1, 101)]);
    return { records: result.rows.map(mapOutcome),
      finalized: result.rows[0] ? count(result.rows[0].outcome_count) : 0,
      nextActionRequested: result.rows[0] ? count(result.rows[0].requested_count) : 0 };
  }

  async create(input: CreateOutcomeInput) {
    const call = await this.callEvidence(input.campaignId, input.dispatchId);
    if (!call) return { status: "not_found" as const };
    await this.session.query(`SELECT pg_advisory_xact_lock(
      hashtextextended($1::text || ':' || $2::text, 0))`, [uuid(call.task_id)]);
    const priorCommand = await this.findByCommand(input.actorUserId,
      input.idempotencyKey);
    if (priorCommand) return priorCommand.requestHash === input.requestHash
      ? { status: "replayed" as const, outcome: priorCommand }
      : { status: "idempotency_conflict" as const };
    if (await this.existsByTask(call.task_id)) {
      return { status: "already_finalized" as const };
    }
    const terminal = terminalEvidence(call);
    if (terminal !== "ready") return { status: "not_ready" as const,
      reasonCode: terminal };
    if (!validEnterpriseMarketingOutcomeCombination(input)) {
      return { status: "evidence_invalid" as const,
        reasonCode: "marketing_outcome_combination_invalid" };
    }
    const due = validateDueAt(input.nextAction?.kind,
      input.nextAction?.dueAt, input.occurredAt);
    if (!due.valid) return { status: "evidence_invalid" as const,
      reasonCode: "marketing_outcome_due_at_invalid" };
    const selected = await this.selectedEvidence(call, input.evidence);
    if (!selected) return { status: "evidence_invalid" as const,
      reasonCode: "marketing_outcome_evidence_not_found" };
    const system = systemEvidence(call);
    const eligibility = eligible(input.disposition, input.intentLevel,
      input.nextAction?.kind, selected, call);
    if (eligibility !== "eligible") return { status: "evidence_invalid" as const,
      reasonCode: eligibility };
    const evidence = [...system, ...selected].sort((left, right) =>
      left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
    const evidenceHash = enterpriseMarketingOutcomeHash(evidence);
    const sourceHash = enterpriseMarketingOutcomeHash({ taskId: call.task_id,
      dispatchId: call.dispatch_id, dispatchVersion: number(call.dispatch_version),
      runId: call.run_id, runVersion: call.run_version, system });
    await this.session.query(`
      INSERT INTO enterprise.marketing_outcomes(
        tenant_id, id, task_id, intent_level, disposition, summary, next_action,
        follow_up_at, evidence_segment_ids, created_at, campaign_id, lead_id,
        dispatch_id, agent_run_id, communication_session_id, evidence_document,
        evidence_hash, source_hash, evidence_status, created_by, idempotency_key,
        request_hash, updated_at, version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16::jsonb,$17,$18,'verified',$19,$20,$21,$10,1)
    `, [uuid(input.outcomeId), uuid(call.task_id), input.intentLevel,
      input.disposition, summary(input.summary), input.nextAction?.kind ?? null,
      due.value ?? null, selected.filter((item) =>
        item.type === "transcript_segment").map((item) => uuid(item.id)),
      iso(input.occurredAt), uuid(call.campaign_id), uuid(call.lead_id),
      uuid(call.dispatch_id), call.run_id ? uuid(call.run_id) : null,
      id(call.communication_session_id), JSON.stringify({ selected: evidence }),
      evidenceHash, sourceHash, actor(input.actorUserId), key(input.idempotencyKey),
      hash(input.requestHash)]);
    if (input.nextAction) await this.session.query(`
      INSERT INTO enterprise.marketing_next_actions(
        tenant_id, id, outcome_id, task_id, campaign_id, lead_id, kind, status,
        due_at, evidence_hash, created_by, idempotency_key, request_hash, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10,$11,$12,$13)
    `, [uuid(input.nextActionId), uuid(input.outcomeId), uuid(call.task_id),
      uuid(call.campaign_id), uuid(call.lead_id), input.nextAction.kind,
      due.value ?? null, evidenceHash, actor(input.actorUserId),
      `outcome-action:${uuid(input.nextActionId)}`,
      enterpriseMarketingOutcomeHash({ outcomeId: input.outcomeId,
        nextAction: input.nextAction, evidenceHash }), iso(input.occurredAt)]);
    const created = await this.findByTask(call.task_id);
    if (!created) throw new Error("Enterprise marketing outcome insert disappeared");
    return { status: "created" as const, outcome: created };
  }

  private async callEvidence(campaignId: string, dispatchId: string) {
    const result = await this.session.query<CallEvidenceRow>(`
      SELECT task.id AS task_id, task.status AS task_status,
        task.campaign_id, task.lead_id, lead.phone_hint,
        dispatch.id AS dispatch_id, dispatch.status AS dispatch_status,
        dispatch.failure_code AS dispatch_failure_code,
        dispatch.communication_session_id, dispatch.ended_at,
        dispatch.updated_at AS dispatch_updated_at,
        dispatch.version AS dispatch_version,
        run.id AS run_id, run.status AS run_status, run.context_hash,
        run.updated_at AS run_updated_at, run.version AS run_version,
        handoff.id AS handoff_id, handoff.status AS handoff_status,
        handoff.provider_receipt_hash AS handoff_receipt_hash,
        handoff.updated_at AS handoff_updated_at,
        suppression.id AS suppression_id,
        suppression.created_at AS suppression_created_at
      FROM enterprise.marketing_pstn_dispatches dispatch
      JOIN enterprise.marketing_call_tasks task
        ON task.tenant_id = dispatch.tenant_id AND task.id = dispatch.task_id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = task.tenant_id AND lead.id = task.lead_id
      LEFT JOIN enterprise.marketing_agent_runs run
        ON run.tenant_id = dispatch.tenant_id AND run.dispatch_id = dispatch.id
      LEFT JOIN enterprise.marketing_handoffs handoff
        ON handoff.tenant_id = dispatch.tenant_id AND handoff.dispatch_id = dispatch.id
      LEFT JOIN LATERAL (
        SELECT item.id, item.created_at FROM enterprise.suppression_entries item
        WHERE item.tenant_id = task.tenant_id AND item.lead_id = task.lead_id
        ORDER BY item.created_at DESC, item.id DESC LIMIT 1
      ) suppression ON true
      WHERE dispatch.tenant_id = $1 AND dispatch.campaign_id = $2
        AND dispatch.id = $3
      FOR UPDATE OF task, dispatch
    `, [uuid(campaignId), uuid(dispatchId)]);
    return result.rows[0] ?? null;
  }

  private async selectedEvidence(call: CallEvidenceRow,
    refs: EnterpriseMarketingOutcomeEvidenceRef[]) {
    const unique = new Map(refs.map((item) => [`${item.type}:${item.id}`, item]));
    if (unique.size !== refs.length || refs.length > 16) return null;
    const transcripts = refs.filter((item) => item.type === "transcript_segment");
    const turns = refs.filter((item) => item.type === "agent_turn");
    const evidence: Evidence[] = [];
    if (transcripts.length) {
      const result = await this.session.queryCommunication<TranscriptRow>(`
        SELECT DISTINCT ON (segment_id) segment_id, revision, source_text,
          translated_text, speaker_role, updated_at, $1::text AS scope_type,
          $2::text AS scope_id
        FROM ai_phone.transcript_segments
        WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
          AND segment_id = ANY($4::uuid[])
        ORDER BY segment_id, revision DESC, updated_at DESC
      `, [id(call.communication_session_id), transcripts.map((item) => uuid(item.id))]);
      evidence.push(...result.rows.map((row) => ({ type: "transcript_segment" as const,
        id: uuid(row.segment_id), revision: number(row.revision),
        contentHash: contentHash({ sourceText: row.source_text,
          translatedText: row.translated_text, speakerRole: row.speaker_role }),
        observedAt: iso(row.updated_at) })));
    }
    if (turns.length && call.run_id) {
      const result = await this.session.query<TurnRow>(`
        SELECT id, version, spoken_text, intent, action, risk_signals, delivered_at
        FROM enterprise.marketing_agent_turns
        WHERE tenant_id = $1 AND run_id = $2 AND status = 'delivered'
          AND id = ANY($3::uuid[])
      `, [uuid(call.run_id), turns.map((item) => uuid(item.id))]);
      evidence.push(...result.rows.map((row) => ({ type: "agent_turn" as const,
        id: uuid(row.id), revision: number(row.version),
        contentHash: contentHash({ spokenText: row.spoken_text, intent: row.intent,
          action: row.action, riskSignals: row.risk_signals }),
        ...(row.delivered_at ? { observedAt: iso(row.delivered_at) } : {}) })));
    }
    return evidence.length === refs.length ? evidence : null;
  }

  private async findByCommand(actorUserId: string, idempotencyKey: string) {
    const result = await this.session.query<OutcomeRow>(`${selectOutcome}
      WHERE outcome.tenant_id = $1 AND outcome.created_by = $2
        AND outcome.idempotency_key = $3 AND outcome.evidence_status = 'verified' LIMIT 1
    `, [actor(actorUserId), key(idempotencyKey)]);
    return result.rows[0] ? mapOutcome(result.rows[0]) : null;
  }
  private async findByTask(taskId: string) {
    const result = await this.session.query<OutcomeRow>(`${selectOutcome}
      WHERE outcome.tenant_id = $1 AND outcome.task_id = $2
        AND outcome.evidence_status = 'verified' LIMIT 1
    `, [uuid(taskId)]);
    return result.rows[0] ? mapOutcome(result.rows[0]) : null;
  }
  private async existsByTask(taskId: string) {
    const result = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.marketing_outcomes
      WHERE tenant_id = $1 AND task_id = $2 LIMIT 1
    `, [uuid(taskId)]);
    return Boolean(result.rows[0]);
  }
}
