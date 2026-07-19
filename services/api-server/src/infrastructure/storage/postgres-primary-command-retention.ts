import type { Pool } from "pg";

export class PostgresPrimaryCommandRetention {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async pruneExpired(limit = 200) {
    return this.prune("primary_command_inbox", "command_id", limit);
  }

  async pruneExpiredInbox(limit = 200) {
    return this.prune("reliable_inbox_events", "event_id", limit);
  }

  private async prune(
    table: "primary_command_inbox" | "reliable_inbox_events",
    key: "command_id" | "event_id",
    limit: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("Primary command retention limit must be 1-1000");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query(`
        WITH expired AS (
          SELECT ${key}
          FROM ai_phone.${table}
          WHERE retain_until <= now()
          ORDER BY retain_until, ${key}
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        DELETE FROM ai_phone.${table} AS record
        USING expired
        WHERE record.${key} = expired.${key}
        RETURNING record.${key}
      `, [limit]);
      await client.query("COMMIT");
      return { deletedCount: deleted.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
