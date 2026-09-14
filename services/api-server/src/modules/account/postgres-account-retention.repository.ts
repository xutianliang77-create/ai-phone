import type { Pool, PoolClient, QueryResultRow } from "pg";

/**
 * Irreversible retention cleanup is deliberately separate from normal product
 * mutations. The caller may invoke it only after the account has already been
 * scrubbed and its approved calendar retention time has elapsed.
 */
export class PostgresAccountRetentionRepository {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async purgeExpiredAccount(accountId: string, now = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<AccountRow>(`
        SELECT payload
        FROM ai_phone.projection_records
        WHERE namespace = 'accounts' AND record_key = $1
        FOR UPDATE
      `, [accountId]);
      if (!eligible(account.rows[0]?.payload, now)) {
        await client.query("COMMIT");
        return { status: "not_due" as const };
      }

      const sessions = await client.query<IdRow>(`
        SELECT id FROM ai_phone.communication_sessions WHERE user_id = $1 FOR UPDATE
      `, [accountId]);
      const sessionIds = sessions.rows.map((row) => row.id);
      const orders = await client.query<IdRow>(`
        SELECT id FROM ai_phone.payment_orders WHERE user_id = $1 FOR UPDATE
      `, [accountId]);
      const orderIds = orders.rows.map((row) => row.id);
      const product = await client.query<ProductKeyRow>(`
        SELECT namespace, record_key
        FROM ai_phone.product_records
        WHERE owner_id = $1 OR (namespace = 'accounts' AND record_key = $1)
        FOR UPDATE
      `, [accountId]);

      await client.query(`
        DELETE FROM ai_phone.reliable_outbox_events WHERE session_id = ANY($1::text[])
      `, [sessionIds]);
      await client.query(`
        DELETE FROM ai_phone.reliable_inbox_events WHERE session_id = ANY($1::text[])
      `, [sessionIds]);
      await client.query(`
        DELETE FROM ai_phone.provider_operations WHERE session_id = ANY($1::text[])
      `, [sessionIds]);
      await client.query(`DELETE FROM ai_phone.communication_sessions WHERE user_id = $1`, [accountId]);
      await client.query(`
        DELETE FROM ai_phone.billing_notifications WHERE order_id = ANY($1::text[])
      `, [orderIds]);
      await client.query(`DELETE FROM ai_phone.payment_orders WHERE user_id = $1`, [accountId]);
      await client.query(`DELETE FROM ai_phone.billing_entitlements WHERE user_id = $1`, [accountId]);
      await client.query(`DELETE FROM ai_phone.billing_ledger_entries WHERE user_id = $1`, [accountId]);
      await client.query(`DELETE FROM ai_phone.usage_holds WHERE user_id = $1`, [accountId]);
      await client.query(`DELETE FROM ai_phone.usage_accounts WHERE user_id = $1`, [accountId]);

      await client.query(`
        DELETE FROM ai_phone.projection_records
        WHERE (namespace, record_key) IN (
          SELECT namespace, record_key FROM ai_phone.product_records
          WHERE owner_id = $1 OR (namespace = 'accounts' AND record_key = $1)
        )
        OR (namespace = 'paymentOrders' AND record_key = ANY($2::text[]))
        OR (namespace IN ('billingEntitlements', 'usageAccounts') AND record_key = $1)
        OR (namespace IN ('usageHolds', 'billingLedger') AND payload->>'userId' = $1)
        OR (namespace IN ('sessions', 'providerOperations') AND record_key = ANY($3::text[]))
      `, [accountId, orderIds, sessionIds]);
      await client.query(`
        DELETE FROM ai_phone.product_records
        WHERE owner_id = $1 OR (namespace = 'accounts' AND record_key = $1)
      `, [accountId]);
      await client.query(`
        DELETE FROM ai_phone.primary_command_inbox
        WHERE (aggregate_type IN ('account', 'billing_account') AND aggregate_id = $1)
          OR (aggregate_type = 'communication_session' AND aggregate_id = ANY($2::text[]))
      `, [accountId, sessionIds]);
      await client.query(`
        DELETE FROM ai_phone.aggregate_writer_leases
        WHERE (aggregate_type IN ('account', 'billing_account') AND aggregate_id = $1)
          OR (aggregate_type = 'communication_session' AND aggregate_id = ANY($2::text[]))
      `, [accountId, sessionIds]);
      await client.query("COMMIT");
      return {
        status: "purged" as const,
        sessionCount: sessionIds.length,
        orderCount: orderIds.length,
        productRecordCount: product.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function eligible(value: unknown, now: Date) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const retentionUntil = typeof record.deletionRetentionUntil === "string"
    ? Date.parse(record.deletionRetentionUntil) : Number.NaN;
  return record.status === "deleted" &&
    typeof record.deletionContentErasedAt === "string" &&
    Number.isFinite(retentionUntil) && retentionUntil <= now.getTime();
}

interface AccountRow extends QueryResultRow { payload: unknown }
interface IdRow extends QueryResultRow { id: string }
interface ProductKeyRow extends QueryResultRow { namespace: string; record_key: string }
