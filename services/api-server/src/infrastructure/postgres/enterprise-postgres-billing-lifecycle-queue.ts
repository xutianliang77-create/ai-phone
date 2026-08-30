import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { mapBillingLifecycleCommand, type BillingLifecycleRow } from
  "./enterprise-postgres-billing-lifecycle-record.js";

export class EnterpriseBillingLifecycleQueuePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async claim(input: {
    commandId: string;
    workerId: string;
    now: string;
    leaseExpiresAt: string;
  }) {
    const current = await this.session.query<BillingLifecycleRow>(`
      SELECT * FROM enterprise.billing_lifecycle_commands
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [input.commandId]);
    const command = current.rows[0] ? mapBillingLifecycleCommand(
      current.rows[0], this.session.context.tenantId,
    ) : null;
    if (!command) return { status: "not_found" as const };
    if (command.status === "completed" || command.status === "failed") {
      return { status: "terminal" as const, command };
    }
    if (Date.parse(command.dueAt) > Date.parse(input.now)) {
      return { status: "deferred" as const, command };
    }
    if (command.status === "processing" && command.leaseExpiresAt &&
      Date.parse(command.leaseExpiresAt) > Date.parse(input.now)) {
      return { status: "busy" as const, command };
    }
    if (command.attempts >= 5) {
      const failed = await this.session.query<BillingLifecycleRow>(`
        UPDATE enterprise.billing_lifecycle_commands
        SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
          error_code = 'retry_exhausted', completed_at = $3,
          updated_at = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $4 RETURNING *
      `, [input.commandId, input.now, command.version]);
      return { status: "failed" as const,
        command: mapBillingLifecycleCommand(
          failed.rows[0]!, this.session.context.tenantId,
        ) };
    }
    const updated = await this.session.query<BillingLifecycleRow>(`
      UPDATE enterprise.billing_lifecycle_commands
      SET status = 'processing', attempts = attempts + 1,
        lease_owner = $3, lease_generation = lease_generation + 1,
        lease_expires_at = $4, error_code = NULL,
        updated_at = $5, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $6 RETURNING *
    `, [input.commandId, input.workerId, input.leaseExpiresAt,
      input.now, command.version]);
    if (!updated.rows[0]) return { status: "conflict" as const };
    return { status: "claimed" as const,
      command: mapBillingLifecycleCommand(
        updated.rows[0], this.session.context.tenantId,
      ) };
  }
}
