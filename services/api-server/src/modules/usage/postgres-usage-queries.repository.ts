import type { Pool, QueryResultRow } from "pg";
import type {
  ImmutableBillingLedgerEntry,
  PostgresUsageBalance,
} from "./postgres-usage-records.js";
import {
  requireLedgerEntry,
  requireUsageAccount,
  usageBalance,
} from "./postgres-usage-uow.js";

export class PostgresUsageQueriesRepository {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async balance(userId: string, now = new Date()): Promise<PostgresUsageBalance | null> {
    validateUserId(userId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const account = await client.query<AccountRow>(`
        SELECT primary_record.payload
        FROM ai_phone.usage_accounts AS account
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'usageAccounts'
          AND primary_record.record_key = account.user_id
        WHERE account.user_id = $1
      `, [userId]);
      if (!account.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const holds = await client.query<HeldRow>(`
        SELECT COALESCE(sum(seconds), 0)::text AS held_seconds
        FROM ai_phone.usage_holds
        WHERE user_id = $1 AND status = 'active' AND expires_at > $2::timestamptz
      `, [userId, now.toISOString()]);
      await client.query("COMMIT");
      const heldSeconds = Number(holds.rows[0]?.held_seconds ?? 0);
      if (!Number.isSafeInteger(heldSeconds) || heldSeconds < 0) {
        throw new Error("Invalid PostgreSQL held usage total");
      }
      return usageBalance(
        requireUsageAccount(account.rows[0].payload, userId),
        heldSeconds,
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ledger(userId: string, limit = 200) {
    validateUserId(userId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid PostgreSQL ledger list limit");
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query<LedgerRow>(`
        SELECT ledger.id, primary_record.payload
        FROM ai_phone.billing_ledger_entries AS ledger
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'billingLedger'
          AND primary_record.record_key = ledger.id
        WHERE ledger.user_id = $1
        ORDER BY ledger.created_at DESC, ledger.id DESC LIMIT $2
      `, [userId, limit]);
      return result.rows.map((row) => requireLedgerEntry(row.payload, row.id));
    } finally {
      client.release();
    }
  }
}

function validateUserId(userId: string) {
  if (!userId.trim() || Buffer.byteLength(userId) > 160) {
    throw new Error("Invalid PostgreSQL usage user id");
  }
}

interface AccountRow extends QueryResultRow { payload: unknown }
interface HeldRow extends QueryResultRow { held_seconds: string }
interface LedgerRow extends QueryResultRow {
  id: string;
  payload: ImmutableBillingLedgerEntry;
}
