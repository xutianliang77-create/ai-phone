import { randomUUID } from "node:crypto";
import type { EnterpriseMarketingAgentTurnOutput } from "@translation/contracts";
import type { EnterpriseMarketingAgentTicketPayload } from
  "../../modules/enterprise/enterprise-marketing-agent-ticket.js";
import type { EnterpriseMarketingAgentResolvedContent } from
  "../../modules/enterprise/enterprise-marketing-agent.js";
import type { EnterpriseMarketingPstnDispatchRecord } from
  "../../modules/enterprise/enterprise-marketing-pstn.js";
import { code, failure, hash, iso, locale, mapMarketingAgentRun,
  mapMarketingAgentTurn, positive, text, uuid,
  type MarketingAgentRunRow, type MarketingAgentTurnRow } from
  "./enterprise-postgres-marketing-agent-record.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMarketingAgentPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createRun(input: { id: string; dispatch: EnterpriseMarketingPstnDispatchRecord;
    leadId: string; content: EnterpriseMarketingAgentResolvedContent;
    providerFingerprint: string; createdAt: string }) {
    const p = input.content.profile; const t = input.content.terminology;
    const result = await this.session.query<MarketingAgentRunRow>(`
      INSERT INTO enterprise.marketing_agent_runs(
        tenant_id, id, dispatch_id, task_id, campaign_id, lead_id,
        communication_session_id, dispatch_generation, route_epoch, profile_id,
        profile_version, term_pack_version_id, script_template_version_id,
        content_context_hash, provider_fingerprint, status, locale,
        conversation_state, disclosure_text, context_document, context_hash,
        last_turn_sequence, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, 'active', $16, 'disclosure', $17, '[]'::jsonb, $18,
        0, $19, $19, 1) ON CONFLICT DO NOTHING RETURNING *
    `, [uuid(input.id), uuid(input.dispatch.id), uuid(input.dispatch.taskId),
      uuid(input.dispatch.campaignId), uuid(input.leadId),
      uuid(input.dispatch.communicationSessionId), input.dispatch.dispatchGeneration,
      input.dispatch.routeEpoch, uuid(p.id), p.version, uuid(t.termPackVersionId),
      uuid(t.scriptTemplateVersionId), hash(t.contextHash),
      code(input.providerFingerprint, 200), locale(p.locale),
      text(p.openingDisclosure, 2_000), emptyHash, iso(input.createdAt)]);
    if (result.rows[0]) return { status: "created" as const,
      run: mapMarketingAgentRun(result.rows[0]) };
    const prior = await this.findByDispatch(input.dispatch.id);
    return prior && prior.id === input.id && prior.contentContextHash === t.contextHash
      ? { status: "replayed" as const, run: prior }
      : { status: "conflict" as const };
  }

  async snapshot(ticket: EnterpriseMarketingAgentTicketPayload, lock = false) {
    const result = await this.session.query<MarketingAgentRunRow>(`
      SELECT run.* FROM enterprise.marketing_agent_runs run
      JOIN enterprise.marketing_pstn_dispatches dispatch
        ON dispatch.tenant_id = run.tenant_id AND dispatch.id = run.dispatch_id
      WHERE run.tenant_id = $1 AND run.id = $2 AND run.dispatch_id = $3
        AND run.task_id = $4 AND run.communication_session_id = $5
        AND run.dispatch_generation = $6 AND run.route_epoch = $7
        AND dispatch.status IN ('accepted', 'answered')
      ${lock ? "FOR UPDATE OF run" : ""}
    `, [uuid(ticket.runId), uuid(ticket.dispatchId), uuid(ticket.taskId),
      uuid(ticket.communicationSessionId), positive(ticket.dispatchGeneration),
      positive(ticket.routeEpoch)]);
    return result.rows[0] ? mapMarketingAgentRun(result.rows[0]) : null;
  }

  async authorizeDisclosure(ticket: EnterpriseMarketingAgentTicketPayload, now: string) {
    const run = await this.snapshot(ticket, true);
    if (!run || run.status !== "active" || run.conversationState !== "disclosure")
      return null;
    if (run.disclosureAuthorizedAt) return run;
    return this.updateRun(run, `disclosure_authorized_at = $3`, [iso(now)]);
  }

  async deliverDisclosure(ticket: EnterpriseMarketingAgentTicketPayload, now: string) {
    const run = await this.snapshot(ticket, true);
    if (!run || run.status !== "active" || !run.disclosureAuthorizedAt) return null;
    if (run.disclosureDeliveredAt) return run;
    return this.updateRun(run,
      `disclosure_delivered_at = $3, conversation_state = 'qualifying'`, [iso(now)]);
  }

  async beginTurn(input: { ticket: EnterpriseMarketingAgentTicketPayload;
    inputTurnId: string; idempotencyKey: string; requestHash: string; locale: string;
    content: EnterpriseMarketingAgentResolvedContent;
    customerTextHash: string; contextHash: string; evidenceHash: string; now: string }) {
    const run = await this.snapshot(input.ticket, true);
    if (!run || run.status !== "active" || !run.disclosureDeliveredAt ||
      run.conversationState === "disclosure") return { status: "not_active" as const };
    const prior = await this.findTurnByKey(run.id, input.idempotencyKey, true);
    if (prior) return prior.requestHash === input.requestHash
      ? { status: "replayed" as const, run, turn: prior }
      : { status: "idempotency_conflict" as const };
    const result = await this.session.query<MarketingAgentTurnRow>(`
      INSERT INTO enterprise.marketing_agent_turns(
        tenant_id, id, run_id, input_turn_id, idempotency_key, request_hash,
        sequence, status, locale, profile_id, profile_version,
        term_pack_version_id, script_template_version_id, content_context_hash,
        customer_text_hash, context_hash, evidence_hash, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'prepared', $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $17, 1) RETURNING *
    `, [randomUUID(), run.id, code(input.inputTurnId, 160),
      code(input.idempotencyKey, 160), hash(input.requestHash),
      run.lastTurnSequence + 1, locale(input.locale), uuid(input.content.profile.id),
      input.content.profile.version, uuid(input.content.terminology.termPackVersionId),
      uuid(input.content.terminology.scriptTemplateVersionId),
      hash(input.content.terminology.contextHash), hash(input.customerTextHash),
      hash(input.contextHash), hash(input.evidenceHash), iso(input.now)]);
    return { status: "created" as const, run,
      turn: mapMarketingAgentTurn(result.rows[0]!) };
  }

  async completeTurn(input: { runId: string; turnId: string;
    expectedEvidenceHash: string;
    output: EnterpriseMarketingAgentTurnOutput;
    status: "generated" | "degraded" | "handoff" | "ended";
    providerFingerprint?: string; failureCode?: string;
    contextDocument: Array<{ role: "customer" | "assistant"; text: string }>;
    contextHash: string; now: string }) {
    const run = await this.findRun(input.runId, true);
    const turn = await this.findTurn(input.turnId, true);
    if (!run || !turn || turn.runId !== run.id ||
      turn.evidenceHash !== hash(input.expectedEvidenceHash) || run.status !== "active" ||
      turn.status !== "prepared") return null;
    const o = input.output; const updatedTurn = await this.session.query<MarketingAgentTurnRow>(`
      UPDATE enterprise.marketing_agent_turns SET status = $3, spoken_text = $4,
        intent = $5, conversation_state = $6, action = $7,
        risk_signals = $8::jsonb, knowledge_citations = $9,
        provider_fingerprint = $10, failure_code = $11,
        updated_at = $12, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $13 RETURNING *
    `, [turn.id, input.status, text(o.spokenText, 2_000), o.intent,
      o.conversationState, o.action, JSON.stringify(o.riskSignals),
      o.knowledgeCitations, input.providerFingerprint
        ? code(input.providerFingerprint, 200) : null,
      input.failureCode ? failure(input.failureCode) : null,
      iso(input.now), turn.version]);
    if (!updatedTurn.rows[0]) return null;
    const runStatus = o.action === "handoff" ? "handoff_requested" :
      o.action === "end_call" ? "ending" : "active";
    const updatedRun = await this.session.query<MarketingAgentRunRow>(`
      UPDATE enterprise.marketing_agent_runs SET status = $3,
        conversation_state = $4, context_document = $5::jsonb,
        context_hash = $6, last_turn_sequence = $7, updated_at = $8,
        version = version + 1 WHERE tenant_id = $1 AND id = $2
        AND version = $9 RETURNING *
    `, [run.id, runStatus, o.conversationState, JSON.stringify(input.contextDocument),
      hash(input.contextHash), turn.sequence, iso(input.now), run.version]);
    if (!updatedRun.rows[0]) throw new Error("Marketing Agent run lost turn fence");
    return { run: mapMarketingAgentRun(updatedRun.rows[0]),
      turn: mapMarketingAgentTurn(updatedTurn.rows[0]) };
  }

  async authorizeTts(ticket: EnterpriseMarketingAgentTicketPayload,
    turnId: string, now: string) {
    const run = await this.snapshot(ticket, true); const turn = await this.findTurn(turnId, true);
    if (!run || !turn || turn.runId !== run.id || !turn.output) return null;
    if (turn.status === "tts_authorized") return { run, turn };
    if (!["generated", "degraded", "handoff", "ended"].includes(turn.status)) return null;
    const result = await this.session.query<MarketingAgentTurnRow>(`
      UPDATE enterprise.marketing_agent_turns SET status = 'tts_authorized',
        tts_authorized_at = $3, updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
    `, [turn.id, iso(now), turn.version]);
    return result.rows[0] ? { run, turn: mapMarketingAgentTurn(result.rows[0]) } : null;
  }

  async deliverTurn(ticket: EnterpriseMarketingAgentTicketPayload,
    turnId: string, now: string) {
    const run = await this.snapshot(ticket, true); const turn = await this.findTurn(turnId, true);
    if (!run || !turn || turn.runId !== run.id || !turn.output ||
      turn.status !== "tts_authorized") return null;
    const result = await this.session.query<MarketingAgentTurnRow>(`
      UPDATE enterprise.marketing_agent_turns SET status = 'delivered',
        delivered_at = $3, updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
    `, [turn.id, iso(now), turn.version]);
    if (!result.rows[0]) return null;
    let completed = run;
    if (turn.output.action !== "continue") {
      const updated = await this.session.query<MarketingAgentRunRow>(`
        UPDATE enterprise.marketing_agent_runs SET status = 'completed',
          updated_at = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
      `, [run.id, iso(now), run.version]);
      if (!updated.rows[0]) throw new Error("Marketing Agent terminal delivery lost fence");
      completed = mapMarketingAgentRun(updated.rows[0]);
    }
    return { run: completed, turn: mapMarketingAgentTurn(result.rows[0]) };
  }

  async finalize(ticket: EnterpriseMarketingAgentTicketPayload,
    status: "completed" | "failed", now: string) {
    const snapshot = await this.session.query<MarketingAgentRunRow>(`
      SELECT run.* FROM enterprise.marketing_agent_runs run
      JOIN enterprise.marketing_pstn_dispatches dispatch
        ON dispatch.tenant_id = run.tenant_id AND dispatch.id = run.dispatch_id
      WHERE run.tenant_id = $1 AND run.id = $2 AND run.dispatch_id = $3
        AND run.task_id = $4 AND run.communication_session_id = $5
        AND run.dispatch_generation = $6 AND run.route_epoch = $7
        AND dispatch.status IN ('accepted', 'answered', 'completed', 'failed')
      FOR UPDATE OF run
    `, [uuid(ticket.runId), uuid(ticket.dispatchId), uuid(ticket.taskId),
      uuid(ticket.communicationSessionId), positive(ticket.dispatchGeneration),
      positive(ticket.routeEpoch)]);
    const run = snapshot.rows[0] ? mapMarketingAgentRun(snapshot.rows[0]) : null;
    if (!run) return null;
    if (["completed", "failed"].includes(run.status)) return run;
    const result = await this.session.query<MarketingAgentRunRow>(`
      UPDATE enterprise.marketing_agent_runs SET status = $3, updated_at = $4,
        version = version + 1 WHERE tenant_id = $1 AND id = $2 AND version = $5
        RETURNING *
    `, [run.id, status, iso(now), run.version]);
    return result.rows[0] ? mapMarketingAgentRun(result.rows[0]) : null;
  }

  private async updateRun(run: ReturnType<typeof mapMarketingAgentRun>, clause: string,
    values: unknown[]) { const result = await this.session.query<MarketingAgentRunRow>(`
      UPDATE enterprise.marketing_agent_runs SET ${clause}, updated_at = $4,
        version = version + 1 WHERE tenant_id = $1 AND id = $2 AND version = $5
        RETURNING *`, [run.id, ...values, iso(values[0]), run.version]);
    return result.rows[0] ? mapMarketingAgentRun(result.rows[0]) : null; }
  private async findByDispatch(id: string) { const result = await this.session.query<MarketingAgentRunRow>(`
    SELECT * FROM enterprise.marketing_agent_runs WHERE tenant_id = $1 AND dispatch_id = $2`,
    [uuid(id)]); return result.rows[0] ? mapMarketingAgentRun(result.rows[0]) : null; }
  private async findRun(id: string, lock = false) { const result = await this.session.query<MarketingAgentRunRow>(`
    SELECT * FROM enterprise.marketing_agent_runs WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`,
    [uuid(id)]); return result.rows[0] ? mapMarketingAgentRun(result.rows[0]) : null; }
  private async findTurn(id: string, lock = false) { const result = await this.session.query<MarketingAgentTurnRow>(`
    SELECT * FROM enterprise.marketing_agent_turns WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`,
    [uuid(id)]); return result.rows[0] ? mapMarketingAgentTurn(result.rows[0]) : null; }
  private async findTurnByKey(runId: string, key: string, lock = false) {
    const result = await this.session.query<MarketingAgentTurnRow>(`
      SELECT * FROM enterprise.marketing_agent_turns WHERE tenant_id = $1
        AND run_id = $2 AND idempotency_key = $3 ${lock ? "FOR UPDATE" : ""}`,
    [uuid(runId), code(key, 160)]); return result.rows[0]
      ? mapMarketingAgentTurn(result.rows[0]) : null; }
}

const emptyHash = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e1d7f9a06ecf0b32c684a1f";
