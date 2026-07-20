import { randomUUID } from "node:crypto";
import type {
  EnterpriseReleaseControlChange,
  EnterpriseReleaseControlRecord,
  EnterpriseReleaseOutcome,
} from "../../modules/enterprise/enterprise-release-control.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  releaseControlRecord,
  releaseControlSnapshot,
  type EnterpriseReleaseControlRow,
} from "./enterprise-postgres-release-control-record.js";

const columns = `tenant_id, capability, enabled, kill_switch_active,
  circuit_state, consecutive_failures, failure_threshold, owner,
  rollout_expires_at, last_failure_at, opened_at, version, created_at, updated_at`;

export class EnterpriseReleaseControlPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async list() {
    const result = await this.session.query<EnterpriseReleaseControlRow>(`
      SELECT ${columns} FROM enterprise.release_controls
      WHERE tenant_id = $1 ORDER BY capability
    `);
    return result.rows.map((row) => releaseControlRecord(
      row, this.session.context.tenantId,
    ));
  }

  async find(capability: string, lock = false) {
    const result = await this.session.query<EnterpriseReleaseControlRow>(`
      SELECT ${columns} FROM enterprise.release_controls
      WHERE tenant_id = $1 AND capability = $2${lock ? " FOR UPDATE" : ""}
    `, [capability]);
    return result.rows[0]
      ? releaseControlRecord(result.rows[0], this.session.context.tenantId)
      : null;
  }

  async change(input: EnterpriseReleaseControlChange) {
    await this.lock(input.capability);
    if (await this.eventExists(input.capability, input.operationId)) {
      return { status: "already_recorded" as const };
    }
    const current = await this.find(input.capability, true);
    if ((current?.version ?? 0) !== input.expectedVersion) {
      return { status: "conflict" as const };
    }
    const next = changedControl(current, input);
    if (!next) return { status: "invalid_transition" as const };
    const stored = current ? await this.update(next, current.version) :
      await this.insert(next);
    if (!stored) return { status: "conflict" as const };
    await this.appendEvent({ input, eventKind: "control_change",
      reason: input.reason, before: current, after: stored });
    return { status: "updated" as const, control: stored };
  }

  async recordOutcome(input: EnterpriseReleaseOutcome) {
    await this.lock(input.capability);
    if (await this.eventExists(input.capability, input.operationId)) {
      return { status: "already_recorded" as const };
    }
    const current = await this.find(input.capability, true);
    if (!current) return { status: "not_found" as const };
    if (!input.probe && input.outcome === "success" &&
      current.circuitState === "closed" && current.consecutiveFailures === 0) {
      return { status: "unchanged" as const, control: current };
    }
    const next = outcomeControl(current, input);
    if (!next) return { status: "invalid_state" as const };
    const stored = await this.update(next, current.version);
    if (!stored) return { status: "invalid_state" as const };
    await this.appendEvent({ input, eventKind: "outcome",
      reason: `${input.outcome}:${input.probe ? "probe" : "normal"}`,
      before: current, after: stored });
    return { status: "updated" as const, control: stored };
  }

  private async insert(control: EnterpriseReleaseControlRecord) {
    const result = await this.session.query<EnterpriseReleaseControlRow>(`
      INSERT INTO enterprise.release_controls(
        tenant_id, capability, enabled, kill_switch_active, circuit_state,
        consecutive_failures, failure_threshold, owner, rollout_expires_at,
        last_failure_at, opened_at, version, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$12)
      RETURNING ${columns}
    `, values(control));
    return result.rows[0]
      ? releaseControlRecord(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private async update(control: EnterpriseReleaseControlRecord, version: number) {
    const result = await this.session.query<EnterpriseReleaseControlRow>(`
      UPDATE enterprise.release_controls SET enabled = $3,
        kill_switch_active = $4, circuit_state = $5,
        consecutive_failures = $6, failure_threshold = $7, owner = $8,
        rollout_expires_at = $9, last_failure_at = $10, opened_at = $11,
        version = version + 1,
        updated_at = GREATEST($12::timestamptz, updated_at + interval '1 microsecond')
      WHERE tenant_id = $1 AND capability = $2 AND version = $13
      RETURNING ${columns}
    `, [...values(control), version]);
    return result.rows[0]
      ? releaseControlRecord(result.rows[0], this.session.context.tenantId)
      : null;
  }

  private async eventExists(capability: string, operationId: string) {
    const result = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.release_control_events
      WHERE tenant_id = $1 AND capability = $2 AND operation_id = $3
    `, [capability, operationId]);
    return Boolean(result.rows[0]);
  }

  private async lock(capability: string) {
    await this.session.queryTenantRecord(`
      SELECT pg_advisory_xact_lock(
        hashtextextended(id::text || ':' || $2, 0))
      FROM enterprise.tenants WHERE id = $1
    `, [capability]);
  }

  private async appendEvent(input: {
    input: EnterpriseReleaseControlChange | EnterpriseReleaseOutcome;
    eventKind: "control_change" | "outcome";
    reason: string;
    before: EnterpriseReleaseControlRecord | null;
    after: EnterpriseReleaseControlRecord;
  }) {
    await this.session.query(`
      INSERT INTO enterprise.release_control_events(
        tenant_id, id, capability, operation_id, event_kind, actor_id,
        trace_id, reason, state_before, state_after, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
    `, [randomUUID(), input.input.capability, input.input.operationId,
      input.eventKind, input.input.actorId, input.input.traceId, input.reason,
      input.before ? JSON.stringify(releaseControlSnapshot(input.before)) : null,
      JSON.stringify(releaseControlSnapshot(input.after)), input.input.now]);
  }
}

function changedControl(
  current: EnterpriseReleaseControlRecord | null,
  input: EnterpriseReleaseControlChange,
): EnterpriseReleaseControlRecord | null {
  const base: EnterpriseReleaseControlRecord = current ? { ...current } : {
    tenantId: input.tenantId, capability: input.capability, enabled: false,
    killSwitchActive: false, circuitState: "closed", consecutiveFailures: 0,
    failureThreshold: input.failureThreshold, owner: input.owner,
    rolloutExpiresAt: input.rolloutExpiresAt, version: 0,
    createdAt: input.now, updatedAt: input.now,
  };
  if (input.action.type === "begin_probe") {
    if (!current || current.circuitState !== "open") return null;
    base.circuitState = "half_open";
  } else if (input.action.type === "set_rollout") {
    base.enabled = input.action.enabled;
  } else {
    base.killSwitchActive = input.action.active;
  }
  return { ...base, failureThreshold: input.failureThreshold, owner: input.owner,
    rolloutExpiresAt: input.rolloutExpiresAt,
    version: current ? current.version + 1 : 1, updatedAt: input.now };
}

function outcomeControl(
  current: EnterpriseReleaseControlRecord,
  input: EnterpriseReleaseOutcome,
): EnterpriseReleaseControlRecord | null {
  if (current.circuitState === "open" ||
    (current.circuitState === "half_open") !== input.probe) return null;
  const next = { ...current, version: current.version + 1, updatedAt: input.now };
  if (input.outcome === "success") {
    next.consecutiveFailures = 0;
    if (input.probe) {
      next.circuitState = "closed";
      delete next.openedAt;
    }
    return next;
  }
  next.consecutiveFailures += 1;
  next.lastFailureAt = input.now;
  if (input.probe || next.consecutiveFailures >= next.failureThreshold) {
    next.circuitState = "open";
    next.openedAt = input.now;
  }
  return next;
}

function values(control: EnterpriseReleaseControlRecord) {
  return [control.capability, control.enabled, control.killSwitchActive,
    control.circuitState, control.consecutiveFailures, control.failureThreshold,
    control.owner, control.rolloutExpiresAt, control.lastFailureAt ?? null,
    control.openedAt ?? null, control.updatedAt];
}
