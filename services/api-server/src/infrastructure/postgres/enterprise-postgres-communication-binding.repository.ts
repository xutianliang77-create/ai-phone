import {
  evaluateEnterpriseCommunicationEvent,
  isEnterpriseCommunicationKind,
  isTerminalEnterpriseCommunicationStatus,
  type EnterpriseCommunicationBindingRecord,
  type EnterpriseCommunicationKind,
  type EnterpriseCommunicationStatus,
} from "../../modules/enterprise/enterprise-communication-session.js";
import {
  modeFor,
  normalizeBindingInput,
  normalizeTransitionInput,
  ownerColumn,
  ownerColumns,
  publicStatus,
  requiredText,
  requiredUuid,
  sameBindingIdentity,
  type BindEnterpriseCommunicationSessionInput,
  type EnterpriseCommunicationTransitionResult,
  type TransitionEnterpriseCommunicationSessionInput,
} from "./enterprise-postgres-communication-binding-input.js";
import {
  mapEnterpriseCommunicationBindingRow,
  type EnterpriseCommunicationBindingPostgresRow,
} from "./enterprise-postgres-communication-binding-row.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseEntitlementResolutionPostgresRepository,
} from "./enterprise-postgres-entitlement-resolution.js";

export type {
  BindEnterpriseCommunicationSessionInput,
  EnterpriseCommunicationTransitionResult,
  TransitionEnterpriseCommunicationSessionInput,
} from "./enterprise-postgres-communication-binding-input.js";

export function createEnterpriseCommunicationBindingPostgresRepository(
  session: EnterpriseTenantPostgresSession,
) {
  return new EnterpriseCommunicationBindingPostgresRepository(session);
}

export class EnterpriseCommunicationBindingPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async bind(input: BindEnterpriseCommunicationSessionInput) {
    const normalized = normalizeBindingInput(input);
    const existing = await this.findBySession(normalized.communicationSessionId);
    if (existing) return this.replayResult(existing, normalized);

    const entitlementState = await new EnterpriseEntitlementResolutionPostgresRepository(
      this.session,
    ).current();
    if (!entitlementState || entitlementState.account.status !== "active" ||
      entitlementState.entitlement.status !== "active") {
      return { status: "entitlement_unavailable" as const };
    }

    const publicSession = await this.session.queryCommunicationMutation<{ id: string }>(`
      INSERT INTO ai_phone.communication_sessions(
        scope_type, scope_id, id, user_id, mode, status,
        consumed_seconds, version, home_region, home_cell_id,
        routing_generation, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, [
      normalized.communicationSessionId,
      this.session.context.actorUserId,
      modeFor(normalized.kind),
      "created",
      0,
      1,
      normalized.homeRegion,
      normalized.cellId,
      normalized.routeEpoch,
      normalized.startedAt,
      normalized.startedAt,
    ]);
    if (!publicSession.rows[0]) {
      throw new Error("Enterprise communication session id already exists");
    }

    const owners = ownerColumns(normalized.kind, normalized.businessId);
    const inserted = await this.session.query<EnterpriseCommunicationBindingPostgresRow>(`
      INSERT INTO enterprise.communication_session_bindings(
        tenant_id, id, communication_session_id, kind,
        meeting_id, support_session_id, marketing_call_task_id,
        status, home_region, cell_id, route_epoch, policy_version,
        entitlement_version, generation, last_event_sequence,
        started_at, updated_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      normalized.bindingId,
      normalized.communicationSessionId,
      normalized.kind,
      owners.meetingId,
      owners.supportSessionId,
      owners.marketingCallTaskId,
      "provisioning",
      normalized.homeRegion,
      normalized.cellId,
      normalized.routeEpoch,
      normalized.policyVersion,
      entitlementState.entitlement.entitlementVersion,
      1,
      0,
      normalized.startedAt,
      normalized.startedAt,
      1,
    ]);
    const row = inserted.rows[0];
    if (row) {
      return {
        status: "created" as const,
        binding: mapEnterpriseCommunicationBindingRow(
          row,
          this.session.context.tenantId,
        ),
      };
    }
    const conflicted = await this.findBySession(normalized.communicationSessionId) ??
      await this.findByBusiness(normalized.kind, normalized.businessId);
    if (!conflicted) throw new Error("Enterprise communication binding conflict");
    return this.replayResult(conflicted, normalized);
  }

  async findBySession(communicationSessionId: string) {
    const sessionId = requiredText(communicationSessionId, "session id", 200);
    const result = await this.session.query<EnterpriseCommunicationBindingPostgresRow>(`
      SELECT * FROM enterprise.communication_session_bindings
      WHERE tenant_id = $1 AND communication_session_id = $2
    `, [sessionId]);
    return this.one(result.rows);
  }

  async findByBusiness(kind: EnterpriseCommunicationKind, businessId: string) {
    if (!isEnterpriseCommunicationKind(kind)) {
      throw new Error("Invalid enterprise communication kind");
    }
    const id = requiredUuid(businessId, "business id");
    const column = ownerColumn(kind);
    const result = await this.session.query<EnterpriseCommunicationBindingPostgresRow>(`
      SELECT * FROM enterprise.communication_session_bindings
      WHERE tenant_id = $1 AND ${column} = $2
    `, [id]);
    return this.one(result.rows);
  }

  async transition(
    input: TransitionEnterpriseCommunicationSessionInput,
  ): Promise<EnterpriseCommunicationTransitionResult> {
    const normalized = normalizeTransitionInput(input);
    const current = await this.findBySession(normalized.communicationSessionId);
    if (!current) return { status: "not_found" };
    if (current.version !== normalized.expectedVersion) {
      return { status: "conflict" };
    }
    const decision = evaluateEnterpriseCommunicationEvent(current, normalized);
    if (decision.status !== "apply") return decision;
    const endedAt = isTerminalEnterpriseCommunicationStatus(
      decision.nextStatus,
    ) ? normalized.occurredAt : null;
    const updated = await this.session.query<EnterpriseCommunicationBindingPostgresRow>(`
      UPDATE enterprise.communication_session_bindings
      SET status = $3, generation = $4, last_event_sequence = $5,
        last_event_at = $6, ended_at = $7, updated_at = $6,
        version = version + 1
      WHERE tenant_id = $1 AND communication_session_id = $2
        AND version = $8 AND route_epoch = $9
        AND (generation < $4 OR
          (generation = $4 AND last_event_sequence < $5))
      RETURNING *
    `, [
      normalized.communicationSessionId,
      decision.nextStatus,
      normalized.generation,
      normalized.sequence,
      normalized.occurredAt,
      endedAt,
      normalized.expectedVersion,
      normalized.routeEpoch,
    ]);
    const row = updated.rows[0];
    if (!row) return { status: "conflict" };
    await this.updatePublicSession(
      normalized.communicationSessionId,
      decision.nextStatus,
      normalized.occurredAt,
      endedAt,
    );
    return {
      status: "updated",
      binding: mapEnterpriseCommunicationBindingRow(
        row,
        this.session.context.tenantId,
      ),
    };
  }

  private one(rows: EnterpriseCommunicationBindingPostgresRow[]) {
    if (rows.length > 1) {
      throw new Error("Enterprise communication binding query returned duplicates");
    }
    return rows[0]
      ? mapEnterpriseCommunicationBindingRow(
          rows[0],
          this.session.context.tenantId,
        )
      : null;
  }

  private replayResult(
    existing: EnterpriseCommunicationBindingRecord,
    input: ReturnType<typeof normalizeBindingInput>,
  ) {
    if (!sameBindingIdentity(existing, input)) {
      throw new Error("Enterprise communication binding replay mismatch");
    }
    return { status: "already_exists" as const, binding: existing };
  }

  private async updatePublicSession(
    sessionId: string,
    status: EnterpriseCommunicationStatus,
    occurredAt: string,
    endedAt: string | null,
  ) {
    const updated = await this.session.queryCommunicationMutation<{ id: string }>(`
      UPDATE ai_phone.communication_sessions
      SET status = $3, last_activity_at = $4, ended_at = $5,
        updated_at = $4, version = version + 1
      WHERE scope_type = $1 AND scope_id = $2 AND id = $6
      RETURNING id
    `, [publicStatus(status), occurredAt, endedAt, sessionId]);
    if (!updated.rows[0]) {
      throw new Error("Enterprise communication session projection is missing");
    }
  }
}
