import type { DatabaseSync } from "node:sqlite";
import type { AppStoreSnapshot } from "./json-store.js";
import type {
  EnterpriseAuditEventRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";

const namespace = "enterpriseAuditEvents";

export class AppendOnlyStorageError extends Error {
  constructor() {
    super("Enterprise audit events are append-only");
    this.name = "AppendOnlyStorageError";
  }
}

export class SqliteAuditStore {
  constructor(private readonly db: DatabaseSync) {}

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enterprise_audit_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS enterprise_audit_events_tenant_created_idx
        ON enterprise_audit_events(tenant_id, created_at DESC, id DESC);
      CREATE TRIGGER IF NOT EXISTS enterprise_audit_events_no_update
      BEFORE UPDATE ON enterprise_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'enterprise audit events are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS enterprise_audit_events_no_delete
      BEFORE DELETE ON enterprise_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'enterprise audit events are append-only');
      END;
    `);
  }

  readInto(snapshot: AppStoreSnapshot) {
    snapshot.enterpriseAuditEvents = this.db.prepare(`
      SELECT payload
      FROM enterprise_audit_events
      ORDER BY created_at, id
    `).all().map((row) =>
      JSON.parse((row as { payload: string }).payload)
    );
  }

  readEntity(recordNamespace: string, key: string) {
    if (recordNamespace !== namespace) return { handled: false as const };
    const row = this.db.prepare(
      "SELECT payload FROM enterprise_audit_events WHERE id = ?",
    ).get(key) as { payload: string } | undefined;
    return { handled: true as const, value: row?.payload };
  }

  writeEntity(recordNamespace: string, valueJson: string) {
    if (recordNamespace !== namespace) return false;
    const record = JSON.parse(valueJson) as EnterpriseAuditEventRecord;
    const existing = this.db.prepare(
      "SELECT 1 FROM enterprise_audit_events WHERE id = ?",
    ).get(record.id);
    if (existing) throw new AppendOnlyStorageError();
    this.db.prepare(`
      INSERT INTO enterprise_audit_events(id, tenant_id, created_at, payload)
      VALUES (?, ?, ?, ?)
    `).run(record.id, record.tenantId, record.createdAt, valueJson);
    return true;
  }

  deleteEntity(recordNamespace: string) {
    if (recordNamespace !== namespace) return false;
    throw new AppendOnlyStorageError();
  }
}
