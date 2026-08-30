import { randomUUID } from "node:crypto";
import type { EnterpriseSupportAgentTurnOutput } from "@translation/contracts";
import type {
  EnterpriseSupportAgentRunRecord,
  EnterpriseSupportAgentRunStatus,
  EnterpriseSupportAgentTurnRecord,
  EnterpriseSupportAgentTurnStatus,
} from "../../modules/enterprise/enterprise-support-agent.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseSupportAgentPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createRun(input: {
    id: string; supportSessionId: string; communicationSessionId: string;
    dispatchGrantId: string; generation: number; locale: string;
    countryCode: string; productCode: string; createdAt: string;
  }) {
    const value = normalizeRun(input);
    const inserted = await this.session.query<RunRow>(`
      INSERT INTO enterprise.support_agent_runs(
        tenant_id, id, support_session_id, communication_session_id,
        dispatch_grant_id, generation, status, locale, country_code,
        product_code, conversation_state, context_document, context_hash,
        last_turn_sequence, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9,
        'qualifying', '[]'::jsonb, $10, 0, $11, $11, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [value.id, value.supportSessionId, value.communicationSessionId,
      value.dispatchGrantId, value.generation, value.locale, value.countryCode,
      value.productCode, emptyHash, value.createdAt]);
    if (inserted.rows[0]) {
      return { status: "created" as const, run: mapRun(inserted.rows[0]) };
    }
    const prior = await this.findRunForGeneration(
      value.supportSessionId, value.generation, true,
    );
    return prior && sameRun(prior, value)
      ? { status: "replayed" as const, run: prior }
      : { status: "conflict" as const };
  }

  async findRun(runId: string, lock = false) {
    const result = await this.session.query<RunRow>(`
      SELECT * FROM enterprise.support_agent_runs
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(runId)]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async findRunForGeneration(sessionId: string, generation: number, lock = false) {
    const result = await this.session.query<RunRow>(`
      SELECT * FROM enterprise.support_agent_runs
      WHERE tenant_id = $1 AND support_session_id = $2 AND generation = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(sessionId), positive(generation)]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async findLatestRunForSession(sessionId: string, lock = false) {
    const result = await this.session.query<RunRow>(`
      SELECT * FROM enterprise.support_agent_runs
      WHERE tenant_id = $1 AND support_session_id = $2
      ORDER BY generation DESC, created_at DESC, id DESC
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(sessionId)]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async listTurnsForRun(runId: string) {
    const result = await this.session.query<TurnRow>(`
      SELECT * FROM enterprise.support_agent_turns
      WHERE tenant_id = $1 AND run_id = $2
      ORDER BY sequence, id
    `, [uuid(runId)]);
    return result.rows.map(mapTurn);
  }

  async beginTurn(input: {
    runId: string; supportSessionId: string; inputTurnId: string;
    idempotencyKey: string; requestHash: string; customerTextHash: string;
    contextHash: string; evidenceHash: string; createdAt: string;
  }) {
    const run = await this.findRun(input.runId, true);
    if (!run || run.supportSessionId !== uuid(input.supportSessionId)) {
      return { status: "not_found" as const };
    }
    const prior = await this.findTurnByKey(run.id, input.idempotencyKey, true);
    if (prior) return prior.requestHash === input.requestHash
      ? { status: "replayed" as const, run, turn: prior }
      : { status: "idempotency_conflict" as const };
    if (run.status !== "active") return { status: "not_active" as const };
    const sequence = run.lastTurnSequence + 1;
    const createdAt = timestamp(input.createdAt);
    const inserted = await this.session.query<TurnRow>(`
      INSERT INTO enterprise.support_agent_turns(
        tenant_id, id, run_id, support_session_id, input_turn_id,
        idempotency_key, request_hash, sequence, status, customer_text_hash,
        context_hash, evidence_hash, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'prepared',
        $9, $10, $11, $12, $12, 1) RETURNING *
    `, [randomUUID(), run.id, run.supportSessionId, key(input.inputTurnId),
      key(input.idempotencyKey), hash(input.requestHash), sequence,
      hash(input.customerTextHash), hash(input.contextHash), hash(input.evidenceHash),
      createdAt]);
    return { status: "created" as const, run, turn: mapTurn(inserted.rows[0]!) };
  }

  async completeTurn(input: {
    runId: string; turnId: string; output: EnterpriseSupportAgentTurnOutput;
    status: "generated" | "degraded" | "handoff";
    providerFingerprint?: string; failureCode?: string;
    contextDocument: Array<{ role: "customer" | "assistant"; text: string }>;
    contextHash: string; completedAt: string;
  }) {
    const run = await this.findRun(input.runId, true);
    const turn = await this.findTurn(input.turnId, true);
    if (!run || !turn || turn.runId !== run.id) return { status: "not_found" as const };
    const alreadyHandoff = run.status === "handoff_requested" &&
      input.status === "handoff" && input.output.intent === "handoff";
    if (turn.status !== "prepared" || run.status !== "active" && !alreadyHandoff) {
      return { status: "conflict" as const };
    }
    const completedAt = timestamp(input.completedAt);
    const output = input.output;
    const updatedTurn = await this.session.query<TurnRow>(`
      UPDATE enterprise.support_agent_turns SET status = $3, spoken_text = $4,
        intent = $5, conversation_state = $6, risk_signals = $7::jsonb,
        knowledge_citations = $8, provider_fingerprint = $9,
        failure_code = $10, updated_at = $11, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $12 AND status = 'prepared'
      RETURNING *
    `, [turn.id, input.status, text(output.spokenText, 2_000), output.intent,
      output.conversationState, JSON.stringify(output.riskSignals),
      output.knowledgeCitations, optionalCode(input.providerFingerprint, 200),
      optionalFailure(input.failureCode), completedAt, turn.version]);
    if (!updatedTurn.rows[0]) return { status: "conflict" as const };
    const runStatus = output.intent === "handoff" ? "handoff_requested" :
      output.intent === "end" ? "ending" : "active";
    const updatedRun = await this.session.query<RunRow>(`
      UPDATE enterprise.support_agent_runs SET status = $3,
        conversation_state = $4, context_document = $5::jsonb,
        context_hash = $6, last_turn_sequence = $7, updated_at = $8,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $9 AND status = $10
      RETURNING *
    `, [run.id, runStatus, output.conversationState,
      JSON.stringify(input.contextDocument), hash(input.contextHash), turn.sequence,
      completedAt, run.version, run.status]);
    if (!updatedRun.rows[0]) throw new Error("Support Agent run update lost turn fence");
    return { status: "updated" as const, run: mapRun(updatedRun.rows[0]),
      turn: mapTurn(updatedTurn.rows[0]) };
  }

  async authorizeTts(input: { runId: string; turnId: string; authorizedAt: string }) {
    const run = await this.findRun(input.runId, true);
    const turn = await this.findTurn(input.turnId, true);
    if (!run || !turn || turn.runId !== run.id) return { status: "not_found" as const };
    if (turn.status === "tts_authorized" && turn.output && turn.ttsAuthorizedAt) {
      if (run.status === "handoff_requested" && turn.output.intent !== "handoff") {
        return { status: "conflict" as const };
      }
      return { status: "authorized" as const, run, turn };
    }
    if (!["active", "handoff_requested", "ending"].includes(run.status) ||
      (run.status === "handoff_requested" && turn.status !== "handoff") ||
      !["generated", "degraded", "handoff"].includes(turn.status)) {
      return { status: "conflict" as const };
    }
    const updated = await this.session.query<TurnRow>(`
      UPDATE enterprise.support_agent_turns SET status = 'tts_authorized',
        tts_authorized_at = $3, updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
    `, [turn.id, timestamp(input.authorizedAt), turn.version]);
    return updated.rows[0]
      ? { status: "authorized" as const, run, turn: mapTurn(updated.rows[0]) }
      : { status: "conflict" as const };
  }

  async requestHandoff(input: { runId: string; requestedAt: string }) {
    const run = await this.findRun(input.runId, true);
    if (!run) return { status: "not_found" as const };
    if (run.status === "handoff_requested") {
      return { status: "requested" as const, run };
    }
    if (run.status !== "active") return { status: "conflict" as const };
    const updated = await this.session.query<RunRow>(`
      UPDATE enterprise.support_agent_runs SET status = 'handoff_requested',
        conversation_state = 'handoff', updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 AND status = 'active'
      RETURNING *
    `, [run.id, timestamp(input.requestedAt), run.version]);
    return updated.rows[0]
      ? { status: "requested" as const, run: mapRun(updated.rows[0]) }
      : { status: "conflict" as const };
  }

  async deliverTurn(input: { runId: string; turnId: string; deliveredAt: string }) {
    const run = await this.findRun(input.runId, true);
    const turn = await this.findTurn(input.turnId, true);
    if (!run || !turn || turn.runId !== run.id) return { status: "not_found" as const };
    if (turn.status === "delivered") return { status: "delivered" as const, turn };
    if (turn.status !== "tts_authorized" ||
      (run.status === "handoff_requested" && turn.output?.intent !== "handoff")) {
      return { status: "conflict" as const };
    }
    const updated = await this.session.query<TurnRow>(`
      UPDATE enterprise.support_agent_turns SET status = 'delivered',
        delivered_at = $3, updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
    `, [turn.id, timestamp(input.deliveredAt), turn.version]);
    return updated.rows[0]
      ? { status: "delivered" as const, turn: mapTurn(updated.rows[0]) }
      : { status: "conflict" as const };
  }

  async finalizeRun(input: {
    runId: string; status: "completed" | "failed" | "cancelled";
    finalizedAt: string;
  }) {
    const run = await this.findRun(input.runId, true);
    if (!run) return { status: "not_found" as const };
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      return run.status === input.status
        ? { status: input.status, run } : { status: "conflict" as const };
    }
    const updated = await this.session.query<RunRow>(`
      UPDATE enterprise.support_agent_runs SET status = $3, updated_at = $4,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $5 RETURNING *
    `, [run.id, input.status, timestamp(input.finalizedAt), run.version]);
    return updated.rows[0]
      ? { status: input.status, run: mapRun(updated.rows[0]) }
      : { status: "conflict" as const };
  }

  async findTurn(turnId: string, lock = false) {
    const result = await this.session.query<TurnRow>(`
      SELECT * FROM enterprise.support_agent_turns
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(turnId)]);
    return result.rows[0] ? mapTurn(result.rows[0]) : null;
  }

  private async findTurnByKey(runId: string, idempotencyKey: string, lock = false) {
    const result = await this.session.query<TurnRow>(`
      SELECT * FROM enterprise.support_agent_turns
      WHERE tenant_id = $1 AND run_id = $2 AND idempotency_key = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(runId), key(idempotencyKey)]);
    return result.rows[0] ? mapTurn(result.rows[0]) : null;
  }
}

const emptyHash = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e1d7f9a06ecf0b32c684a1f";

function mapRun(row: RunRow): EnterpriseSupportAgentRunRecord {
  return { id: row.id, tenantId: row.tenant_id,
    supportSessionId: row.support_session_id,
    communicationSessionId: row.communication_session_id,
    dispatchGrantId: row.dispatch_grant_id, generation: Number(row.generation),
    status: row.status, locale: row.locale, countryCode: row.country_code,
    productCode: row.product_code, conversationState: row.conversation_state,
    contextDocument: row.context_document, contextHash: row.context_hash,
    lastTurnSequence: Number(row.last_turn_sequence), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), version: Number(row.version) };
}
function mapTurn(row: TurnRow): EnterpriseSupportAgentTurnRecord {
  const output = row.spoken_text && row.intent && row.conversation_state ? {
    spokenText: row.spoken_text, intent: row.intent, toolRequest: null,
    riskSignals: row.risk_signals, knowledgeCitations: row.knowledge_citations,
    conversationState: row.conversation_state,
  } satisfies EnterpriseSupportAgentTurnOutput : undefined;
  return { id: row.id, tenantId: row.tenant_id, runId: row.run_id,
    supportSessionId: row.support_session_id, inputTurnId: row.input_turn_id,
    idempotencyKey: row.idempotency_key, requestHash: row.request_hash,
    sequence: Number(row.sequence), status: row.status,
    customerTextHash: row.customer_text_hash, contextHash: row.context_hash,
    evidenceHash: row.evidence_hash, ...(output ? { output } : {}),
    ...(row.provider_fingerprint ? { providerFingerprint: row.provider_fingerprint } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.tts_authorized_at ? { ttsAuthorizedAt: iso(row.tts_authorized_at) } : {}),
    ...(row.delivered_at ? { deliveredAt: iso(row.delivered_at) } : {}),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    version: Number(row.version) };
}

interface RunRow extends Record<string, unknown> {
  id: string; tenant_id: string; support_session_id: string;
  communication_session_id: string; dispatch_grant_id: string;
  generation: string | number; status: EnterpriseSupportAgentRunStatus;
  locale: string; country_code: string; product_code: string;
  conversation_state: EnterpriseSupportAgentRunRecord["conversationState"];
  context_document: EnterpriseSupportAgentRunRecord["contextDocument"];
  context_hash: string; last_turn_sequence: string | number;
  created_at: string | Date; updated_at: string | Date; version: string | number;
}
interface TurnRow extends Record<string, unknown> {
  id: string; tenant_id: string; run_id: string; support_session_id: string;
  input_turn_id: string; idempotency_key: string; request_hash: string;
  sequence: string | number; status: EnterpriseSupportAgentTurnStatus;
  customer_text_hash: string; context_hash: string; evidence_hash: string;
  spoken_text: string | null; intent: EnterpriseSupportAgentTurnOutput["intent"] | null;
  conversation_state: EnterpriseSupportAgentTurnOutput["conversationState"] | null;
  risk_signals: string[]; knowledge_citations: string[];
  provider_fingerprint: string | null; failure_code: string | null;
  tts_authorized_at: string | Date | null; delivered_at: string | Date | null;
  created_at: string | Date; updated_at: string | Date; version: string | number;
}

function normalizeRun(input: Parameters<EnterpriseSupportAgentPostgresRepository["createRun"]>[0]) {
  return { ...input, id: uuid(input.id), supportSessionId: uuid(input.supportSessionId),
    communicationSessionId: uuid(input.communicationSessionId),
    dispatchGrantId: uuid(input.dispatchGrantId), generation: positive(input.generation),
    locale: locale(input.locale), countryCode: country(input.countryCode),
    productCode: code(input.productCode, 80), createdAt: timestamp(input.createdAt) };
}
function sameRun(run: EnterpriseSupportAgentRunRecord, input: ReturnType<typeof normalizeRun>) {
  return run.supportSessionId === input.supportSessionId &&
    run.communicationSessionId === input.communicationSessionId &&
    run.dispatchGrantId === input.dispatchGrantId && run.generation === input.generation &&
    run.locale === input.locale && run.countryCode === input.countryCode &&
    run.productCode === input.productCode;
}
function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid Support Agent uuid"); return value; }
function positive(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("Invalid Support Agent number"); return Number(value); }
function key(value: unknown) { return code(value, 160); }
function code(value: unknown, max: number) { if (typeof value !== "string" || Buffer.byteLength(value) > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error("Invalid Support Agent code"); return value; }
function optionalCode(value: unknown, max: number) { return value === undefined ? null : code(value, max); }
function optionalFailure(value: unknown) { if (value === undefined) return null; if (typeof value !== "string" || !/^[a-z][a-z0-9_]{1,79}$/.test(value)) throw new Error("Invalid Support Agent failure"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid Support Agent hash"); return value; }
function locale(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) throw new Error("Invalid Support Agent locale"); return value; }
function country(value: unknown) { if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) throw new Error("Invalid Support Agent country"); return value; }
function text(value: unknown, max: number) { if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value.trim()) > max) throw new Error("Invalid Support Agent text"); return value.trim(); }
function timestamp(value: unknown) { if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error("Invalid Support Agent timestamp"); return value; }
function iso(value: string | Date) { return new Date(value).toISOString(); }
