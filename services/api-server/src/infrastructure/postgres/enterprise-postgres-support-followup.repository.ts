import type {
  EnterpriseSupportCallbackRecord,
  EnterpriseSupportFollowupRecord,
} from "../../modules/enterprise/enterprise-support.js";
import type { EnterpriseSupportWritePublishReceipt } from
  "../../modules/enterprise/enterprise-support-write-tool.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseSupportFollowupPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createCallback(input: {
    id: string; sessionId: string; customerId: string; scheduledAt: string;
    reason: string; createdBy: string; createdAt: string;
  }) {
    const result = await this.session.query<CallbackRow>(`
      INSERT INTO enterprise.support_callbacks(
        tenant_id, id, session_id, customer_id, scheduled_at, reason, status,
        created_by, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, 'dispatch_pending', $7, $8, $8, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [uuid(input.id), uuid(input.sessionId), uuid(input.customerId),
      timestamp(input.scheduledAt), text(input.reason, 500),
      enterprisePostgresAccountSubjectId(input.createdBy), timestamp(input.createdAt)]);
    return result.rows[0] ? mapCallback(result.rows[0]) : null;
  }

  async createCommand(input: {
    id: string; sessionId: string; customerId: string; agentClaimId: string;
    kind: "ticket" | "callback"; caseId?: string; callbackId?: string;
    idempotencyKey: string; requestHash: string; outboxEventId: string;
    providerFingerprint: string; providerSimulated: boolean;
    createdBy: string; createdAt: string;
  }) {
    const result = await this.session.query<FollowupRow>(`
      INSERT INTO enterprise.support_followup_commands(
        tenant_id, id, session_id, customer_id, agent_claim_id, kind,
        case_id, callback_id, status, idempotency_key, request_hash,
        outbox_event_id, provider_fingerprint, provider_simulated, attempts,
        created_by, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', $9, $10,
        $11, $12, $13, 0, $14, $15, $15, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [uuid(input.id), uuid(input.sessionId), uuid(input.customerId),
      uuid(input.agentClaimId), input.kind,
      input.caseId ? uuid(input.caseId) : null,
      input.callbackId ? uuid(input.callbackId) : null,
      key(input.idempotencyKey), hash(input.requestHash), uuid(input.outboxEventId),
      fingerprint(input.providerFingerprint), input.providerSimulated,
      enterprisePostgresAccountSubjectId(input.createdBy), timestamp(input.createdAt)]);
    return result.rows[0] ? mapFollowup(result.rows[0]) : null;
  }

  async findByKey(sessionId: string, idempotencyKey: string, lock = false) {
    const result = await this.session.query<FollowupRow>(`
      SELECT * FROM enterprise.support_followup_commands
      WHERE tenant_id = $1 AND session_id = $2 AND idempotency_key = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(sessionId), key(idempotencyKey)]);
    return result.rows[0] ? mapFollowup(result.rows[0]) : null;
  }

  async findByOutbox(eventId: string, lock = false) {
    const result = await this.session.query<FollowupRow>(`
      SELECT * FROM enterprise.support_followup_commands
      WHERE tenant_id = $1 AND outbox_event_id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(eventId)]);
    return result.rows[0] ? mapFollowup(result.rows[0]) : null;
  }

  async listForSession(sessionId: string) {
    const [commands, callbacks] = await Promise.all([
      this.session.query<FollowupRow>(`
        SELECT * FROM enterprise.support_followup_commands
        WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at, id
      `, [uuid(sessionId)]),
      this.session.query<CallbackRow>(`
        SELECT * FROM enterprise.support_callbacks
        WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at, id
      `, [uuid(sessionId)]),
    ]);
    return {
      followups: commands.rows.map(mapFollowup),
      callbacks: callbacks.rows.map(mapCallback),
    };
  }

  async finalize(input: {
    command: EnterpriseSupportFollowupRecord; attempt: number;
    outcome: { status: "retry"; reasonCode: string } |
      { status: "failed"; reasonCode: string; providerReference: string } |
      { status: "completed"; receipt: EnterpriseSupportWritePublishReceipt &
          { outcome: "completed" } };
    updatedAt: string;
  }) {
    if (!Number.isSafeInteger(input.attempt) || input.attempt <= input.command.attempts) {
      return null;
    }
    const at = timestamp(input.updatedAt);
    if (input.outcome.status === "completed") {
      await this.finalizeBusiness(input.command, input.outcome.receipt, at);
    } else if (input.outcome.status === "failed" && input.command.callbackId) {
      await this.finishCallback(input.command.callbackId, "failed", at,
        input.outcome.reasonCode);
    }
    const terminal = input.outcome.status !== "retry";
    const result = await this.session.query<FollowupRow>(`
      UPDATE enterprise.support_followup_commands SET status = $3,
        provider_reference = $4, result_hash = $5, failure_code = $6,
        attempts = $7, completed_at = $8, updated_at = $9, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'processing'
        AND attempts < $7 RETURNING *
    `, [uuid(input.command.id), input.outcome.status === "retry" ? "processing" :
      input.outcome.status, input.outcome.status === "retry" ? null :
      input.outcome.status === "completed"
        ? input.outcome.receipt.providerReference : input.outcome.providerReference,
      input.outcome.status === "completed" ? input.outcome.receipt.resultHash : null,
      input.outcome.status === "completed" ? null : input.outcome.reasonCode,
      input.attempt, terminal ? at : null, at]);
    return result.rows[0] ? mapFollowup(result.rows[0]) : null;
  }

  private async finalizeBusiness(command: EnterpriseSupportFollowupRecord,
    receipt: EnterpriseSupportWritePublishReceipt & { outcome: "completed" }, at: string) {
    if (command.kind === "ticket" && command.caseId && receipt.result.kind === "ticket") {
      const result = await this.session.query<{ id: string }>(`
        UPDATE enterprise.support_cases SET status = 'open',
          external_ticket_id = $3, updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
          AND external_ticket_id IS NULL
        RETURNING id
      `, [uuid(command.caseId), text(receipt.result.ticketId, 200), at]);
      if (result.rows.length !== 1) throw new Error("Support ticket projection conflict");
      return;
    }
    if (command.kind === "callback" && command.callbackId &&
      receipt.result.kind === "callback") {
      await this.finishCallback(command.callbackId, "scheduled", at,
        undefined, receipt.result.callbackId);
      return;
    }
    throw new Error("Support followup result kind mismatch");
  }

  private async finishCallback(callbackId: string, status: "scheduled" | "failed",
    at: string, failureCode?: string, externalId?: string) {
    const result = await this.session.query<{ id: string }>(`
      UPDATE enterprise.support_callbacks SET status = $3,
        external_callback_id = $4, failure_code = $5, completed_at = $6,
        updated_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'dispatch_pending'
      RETURNING id
    `, [uuid(callbackId), status, externalId ? text(externalId, 200) : null,
      failureCode ? code(failureCode) : null, at]);
    if (result.rows.length !== 1) throw new Error("Support callback projection conflict");
  }
}

interface CallbackRow extends Record<string, unknown> {
  id: string; tenant_id: string; session_id: string; customer_id: string;
  scheduled_at: string | Date; reason: string;
  status: EnterpriseSupportCallbackRecord["status"];
  external_callback_id: string | null; failure_code: string | null;
  created_by: string; created_at: string | Date; updated_at: string | Date;
  completed_at: string | Date | null; version: string | number;
}
interface FollowupRow extends Record<string, unknown> {
  id: string; tenant_id: string; session_id: string; customer_id: string;
  agent_claim_id: string; kind: EnterpriseSupportFollowupRecord["kind"];
  case_id: string | null; callback_id: string | null;
  status: EnterpriseSupportFollowupRecord["status"];
  idempotency_key: string; request_hash: string; outbox_event_id: string;
  provider_fingerprint: string; provider_simulated: boolean;
  provider_reference: string | null; result_hash: string | null;
  failure_code: string | null;
  attempts: string | number; created_by: string; created_at: string | Date;
  updated_at: string | Date; completed_at: string | Date | null;
  version: string | number;
}

function mapCallback(row: CallbackRow): EnterpriseSupportCallbackRecord {
  return { id: row.id, tenantId: row.tenant_id, sessionId: row.session_id,
    customerId: row.customer_id, scheduledAt: iso(row.scheduled_at),
    reason: row.reason, status: row.status,
    ...(row.external_callback_id ? { externalCallbackId: row.external_callback_id } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    createdBy: row.created_by, createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    version: Number(row.version) };
}
function mapFollowup(row: FollowupRow): EnterpriseSupportFollowupRecord {
  return { id: row.id, tenantId: row.tenant_id, sessionId: row.session_id,
    customerId: row.customer_id, agentClaimId: row.agent_claim_id, kind: row.kind,
    ...(row.case_id ? { caseId: row.case_id } : {}),
    ...(row.callback_id ? { callbackId: row.callback_id } : {}),
    status: row.status, idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash, outboxEventId: row.outbox_event_id,
    providerFingerprint: row.provider_fingerprint,
    providerSimulated: row.provider_simulated,
    ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
    ...(row.result_hash ? { resultHash: row.result_hash } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    attempts: Number(row.attempts), createdBy: row.created_by,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    version: Number(row.version) };
}
function uuid(value: unknown) { const item = text(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item))
    throw new Error("Invalid support followup ID"); return item; }
function text(value: unknown, maximum: number) { const item = typeof value === "string"
  ? value.trim() : ""; if (!item || Buffer.byteLength(item) > maximum)
  throw new Error("Invalid support followup text"); return item; }
function timestamp(value: unknown) { const item = text(value, 64);
  if (!Number.isFinite(Date.parse(item)) || new Date(item).toISOString() !== item)
    throw new Error("Invalid support followup time"); return item; }
function key(value: unknown) { const item = text(value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(item))
    throw new Error("Invalid support followup key"); return item; }
function hash(value: unknown) { const item = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(item)) throw new Error("Invalid support followup hash");
  return item; }
function fingerprint(value: unknown) { const item = text(value, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item))
    throw new Error("Invalid support Provider fingerprint"); return item; }
function code(value: unknown) { const item = text(value, 64);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(item))
    throw new Error("Invalid support followup code"); return item; }
function iso(value: string | Date) { return new Date(value).toISOString(); }
