import type {
  EnterpriseMarketingMonitoringCallResponse,
  EnterpriseMarketingMonitoringSnapshotResponse,
} from "@translation/contracts";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  bounded,
  count,
  mapMarketingMonitorCall,
  mapMarketingMonitorCaption,
  mapMarketingMonitorOperation,
  mapMarketingMonitorTurn,
  requiredId,
  uuid,
  type CallRow,
  type CaptionRow,
  type CountRow,
  type OperationRow,
  type TurnRow,
} from "./enterprise-postgres-marketing-monitoring-record.js";

export class EnterpriseMarketingMonitoringPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async snapshot(campaignId: string, now = new Date()):
    Promise<EnterpriseMarketingMonitoringSnapshotResponse | null> {
    if (!await this.campaignExists(campaignId)) return null;
    const [countResult, callResult] = await Promise.all([
      this.session.query<CountRow>(`
        SELECT count(*)::text AS total,
          count(*) FILTER (WHERE dispatch_status IN ('accepted', 'answered'))::text
            AS active,
          count(*) FILTER (WHERE dispatch_status = 'failed' OR
            run_status = 'failed' OR turn_failure IS NOT NULL)::text AS failed,
          count(*) FILTER (WHERE dispatch_status IN ('unknown', 'failed') OR
            run_status IN ('failed', 'handoff_requested') OR turn_failure IS NOT NULL OR
            jsonb_array_length(risk_signals) > 0 OR
            (dispatch_status IN ('accepted', 'answered') AND
              monitor_updated_at < $3::timestamptz - interval '15 seconds') OR
            (dispatch_status IN ('accepted', 'answered') AND run_id IS NOT NULL AND
              disclosure_delivered_at IS NULL AND
              monitor_updated_at < $3::timestamptz - interval '10 seconds'))::text
            AS attention_required
        FROM (
          SELECT dispatch.status AS dispatch_status, run.id AS run_id,
            run.status AS run_status, run.disclosure_delivered_at,
            latest.failure_code AS turn_failure,
            COALESCE(latest.risk_signals, '[]'::jsonb) AS risk_signals,
            GREATEST(dispatch.updated_at,
              COALESCE(run.updated_at, dispatch.updated_at),
              COALESCE(latest.updated_at, dispatch.updated_at)) AS monitor_updated_at
          FROM enterprise.marketing_pstn_dispatches dispatch
          LEFT JOIN enterprise.marketing_agent_runs run
            ON run.tenant_id = dispatch.tenant_id AND run.dispatch_id = dispatch.id
          LEFT JOIN LATERAL (
            SELECT turn.failure_code, turn.risk_signals, turn.updated_at
            FROM enterprise.marketing_agent_turns turn
            WHERE turn.tenant_id = dispatch.tenant_id AND turn.run_id = run.id
            ORDER BY turn.sequence DESC, turn.id DESC LIMIT 1
          ) latest ON true
          WHERE dispatch.tenant_id = $1 AND dispatch.campaign_id = $2
        ) monitored
      `, [uuid(campaignId), now.toISOString()]),
      this.callRows(campaignId, undefined, 101),
    ]);
    const rows = callResult.rows;
    const counts = countResult.rows[0] ?? {
      total: "0", active: "0", failed: "0", attention_required: "0",
    };
    return {
      campaignId,
      generatedAt: now.toISOString(),
      transport: {
        mode: "snapshot",
        refreshAfterMs: 5000,
        streamStatus: "not_configured",
        reasonCode: "marketing_monitor_realtime_stream_not_configured",
      },
      counts: {
        total: count(counts.total),
        active: count(counts.active),
        attentionRequired: count(counts.attention_required),
        failed: count(counts.failed),
      },
      calls: rows.slice(0, 100).map((row) => mapMarketingMonitorCall(row, now)),
      truncated: rows.length > 100,
    };
  }

  async call(campaignId: string, dispatchId: string, now = new Date()):
    Promise<EnterpriseMarketingMonitoringCallResponse | null> {
    const result = await this.callRows(campaignId, dispatchId, 1);
    const row = result.rows[0];
    if (!row) return null;
    const [captions, turns, operations] = await Promise.all([
      this.captions(row.communication_session_id),
      row.run_id ? this.turns(row.run_id) : Promise.resolve([]),
      this.operations(row.communication_session_id),
    ]);
    return {
      generatedAt: now.toISOString(),
      call: mapMarketingMonitorCall(row, now),
      captions: {
        status: captions.length > 0 ? "available" : "no_samples",
        finalRevisions: captions,
      },
      agentTurns: turns,
      providerOperations: operations,
    };
  }

  private campaignExists(campaignId: string) {
    return this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1 AND id = $2
    `, [uuid(campaignId)]).then((result) => Boolean(result.rows[0]));
  }

  private callRows(campaignId: string, dispatchId: string | undefined, limit: number) {
    return this.session.query<CallRow>(`
      SELECT dispatch.id AS dispatch_id, dispatch.task_id,
        dispatch.communication_session_id, dispatch.provider,
        dispatch.status AS dispatch_status, dispatch.failure_code AS dispatch_failure,
        dispatch.prepared_at, dispatch.accepted_at, dispatch.answered_at,
        dispatch.ended_at, task.status AS task_status,
        lead.id AS lead_id, lead.phone_hint,
        run.id AS run_id, run.status AS run_status,
        run.conversation_state, run.disclosure_delivered_at,
        run.updated_at AS run_updated_at,
        latest.status AS turn_status, latest.intent AS latest_intent,
        latest.risk_signals, latest.failure_code AS turn_failure,
        latest.updated_at AS turn_updated_at,
        GREATEST(dispatch.updated_at, COALESCE(run.updated_at, dispatch.updated_at),
          COALESCE(latest.updated_at, dispatch.updated_at)) AS monitor_updated_at
      FROM enterprise.marketing_pstn_dispatches dispatch
      JOIN enterprise.marketing_call_tasks task
        ON task.tenant_id = dispatch.tenant_id AND task.id = dispatch.task_id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = dispatch.tenant_id AND lead.id = task.lead_id
      LEFT JOIN enterprise.marketing_agent_runs run
        ON run.tenant_id = dispatch.tenant_id AND run.dispatch_id = dispatch.id
      LEFT JOIN LATERAL (
        SELECT turn.status, turn.intent, turn.risk_signals, turn.failure_code,
          turn.updated_at
        FROM enterprise.marketing_agent_turns turn
        WHERE turn.tenant_id = dispatch.tenant_id AND turn.run_id = run.id
        ORDER BY turn.sequence DESC, turn.id DESC LIMIT 1
      ) latest ON true
      WHERE dispatch.tenant_id = $1 AND dispatch.campaign_id = $2
        AND ($3::uuid IS NULL OR dispatch.id = $3::uuid)
      ORDER BY CASE WHEN dispatch.status IN ('accepted', 'answered') THEN 0
        WHEN dispatch.status IN ('unknown', 'failed') THEN 1 ELSE 2 END,
        monitor_updated_at DESC, dispatch.id
      LIMIT $4
    `, [uuid(campaignId), dispatchId ? uuid(dispatchId) : null, bounded(limit)]);
  }

  private async captions(sessionId: string) {
    const result = await this.session.queryCommunication<CaptionRow>(`
      SELECT segment_id, max(revision) AS revision,
        (array_agg(source_text ORDER BY revision DESC, updated_at DESC))[1]
          AS source_text,
        (array_agg(translated_text ORDER BY revision DESC, updated_at DESC))[1]
          AS translated_text,
        (array_agg(source_language ORDER BY revision DESC, updated_at DESC))[1]
          AS source_language,
        (array_agg(target_language ORDER BY revision DESC, updated_at DESC))[1]
          AS target_language,
        (array_agg(speaker_role ORDER BY revision DESC, updated_at DESC))[1]
          AS speaker_role,
        (array_agg(start_ms ORDER BY revision DESC, updated_at DESC))[1] AS start_ms,
        (array_agg(end_ms ORDER BY revision DESC, updated_at DESC))[1] AS end_ms,
        max(updated_at) AS updated_at, $1::text AS scope_type, $2::text AS scope_id
      FROM ai_phone.transcript_segments
      WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
      GROUP BY segment_id
      ORDER BY max(updated_at) DESC, segment_id LIMIT 200
    `, [requiredId(sessionId)]);
    return result.rows.map((row) => mapMarketingMonitorCaption(
      row,
      this.session.context.tenantId,
    ))
      .filter((item) => item.sourceText.length > 0)
      .sort((left, right) => (left.startMs ?? Number.MAX_SAFE_INTEGER) -
        (right.startMs ?? Number.MAX_SAFE_INTEGER) ||
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.segmentId.localeCompare(right.segmentId)).slice(-200);
  }

  private async turns(runId: string) {
    const result = await this.session.query<TurnRow>(`
      SELECT id, sequence, status, spoken_text, intent, conversation_state,
        action, risk_signals, knowledge_citations, failure_code,
        tts_authorized_at, delivered_at, created_at, updated_at
      FROM enterprise.marketing_agent_turns
      WHERE tenant_id = $1 AND run_id = $2
      ORDER BY sequence DESC, id DESC LIMIT 100
    `, [uuid(runId)]);
    return result.rows.reverse().map(mapMarketingMonitorTurn);
  }

  private async operations(sessionId: string) {
    const result = await this.session.queryCommunication<OperationRow>(`
      SELECT id, provider, operation_type, status, started_at, ended_at
      FROM ai_phone.provider_operations
      WHERE scope_type = $1 AND scope_id = $2 AND session_id = $3
      ORDER BY started_at DESC, id DESC LIMIT 200
    `, [requiredId(sessionId)]);
    return result.rows.reverse().map(mapMarketingMonitorOperation);
  }
}
