import { createHash } from "node:crypto";

export interface EnterpriseCutoverQueryClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface EnterpriseDatabaseTableManifest {
  primaryKey: string[];
  count: number;
  sha256: string;
  lastKeySha256?: string;
}

export interface EnterpriseDatabaseManifest {
  formatVersion: 1;
  logicalId: string;
  database: {
    name: string;
    oid: string;
    systemIdentifier: string;
    serverVersionNum: string;
    inRecovery: boolean;
  };
  snapshot: string;
  walLsn: string;
  defaultTransactionReadOnly: boolean;
  publicMigrations: string[];
  enterpriseMigrations: Array<{ id: string; checksum: string }>;
  tables: Record<string, EnterpriseDatabaseTableManifest>;
  critical: Record<string, EnterpriseDatabaseTableManifest>;
  totalCount: number;
  sha256: string;
  capturedAt: string;
}

const schemas = ["ai_phone", "enterprise"] as const;
export const enterpriseCutoverCriticalTables = [
  "enterprise.tenants",
  "ai_phone.communication_sessions",
  "enterprise.usage_ledger",
  "enterprise.audit_events",
  "enterprise.contact_consents",
  "enterprise.suppression_entries",
  "enterprise.marketing_country_policy_versions",
  "enterprise.marketing_campaign_validation_snapshots",
  "enterprise.marketing_campaign_approval_decisions",
  "enterprise.marketing_pstn_dispatches",
  "ai_phone.recording_artifacts",
  "enterprise.meeting_artifacts",
] as const;

export async function collectEnterpriseDatabaseManifest(
  client: EnterpriseCutoverQueryClient,
  logicalId: string,
  options: { pageSize?: number } = {},
): Promise<EnterpriseDatabaseManifest> {
  assertLogicalId(logicalId);
  const pageSize = options.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5_000) {
    throw new Error("Enterprise cutover page size must be 1-5000");
  }
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    await assertFullDatabaseReadRole(client);
    const identity = await readIdentity(client);
    const migrations = await readMigrations(client);
    const tableNames = await readTableNames(client);
    const tables: Record<string, EnterpriseDatabaseTableManifest> = {};
    for (const tableName of tableNames) {
      tables[tableName] = await readTableManifest(client, tableName, pageSize);
    }
    const critical = Object.fromEntries(
      enterpriseCutoverCriticalTables.map((name) => {
        const manifest = tables[name];
        if (!manifest) throw new Error(`Enterprise cutover critical table missing: ${name}`);
        return [name, manifest];
      }),
    );
    const totalCount = Object.values(tables).reduce((sum, table) => {
      const value = sum + table.count;
      if (!Number.isSafeInteger(value)) throw new Error("Enterprise cutover row count overflow");
      return value;
    }, 0);
    const content = {
      publicMigrations: migrations.publicMigrations,
      enterpriseMigrations: migrations.enterpriseMigrations,
      tables,
      critical,
      totalCount,
    };
    const manifest: EnterpriseDatabaseManifest = {
      formatVersion: 1,
      logicalId,
      database: identity.database,
      snapshot: identity.snapshot,
      walLsn: identity.walLsn,
      defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
      ...migrations,
      tables,
      critical,
      totalCount,
      sha256: sha256(stableJson(content)),
      capturedAt: new Date().toISOString(),
    };
    await client.query("COMMIT");
    return manifest;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function assertFullDatabaseReadRole(client: EnterpriseCutoverQueryClient) {
  const result = await client.query<{
    role_name: string;
    is_superuser: boolean;
    bypass_rls: boolean;
  }>(`
    SELECT role_record.rolname AS role_name,
      role_record.rolsuper AS is_superuser,
      role_record.rolbypassrls AS bypass_rls
    FROM pg_roles role_record WHERE role_record.rolname = current_user
  `);
  const role = result.rows[0];
  if (!role?.role_name || (!role.is_superuser && !role.bypass_rls)) {
    throw new Error("Enterprise cutover requires an audited full-read maintenance role");
  }
}

async function readIdentity(client: EnterpriseCutoverQueryClient) {
  const result = await client.query<{
    name: string;
    oid: string;
    system_identifier: string;
    server_version_num: string;
    in_recovery: boolean;
    snapshot: string;
    wal_lsn: string;
    default_read_only: string;
  }>(`
    SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
      (pg_control_system()).system_identifier::text AS system_identifier,
      current_setting('server_version_num') AS server_version_num,
      pg_is_in_recovery() AS in_recovery,
      txid_current_snapshot()::text AS snapshot,
      CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()::text
        ELSE pg_current_wal_lsn()::text END AS wal_lsn,
      current_setting('default_transaction_read_only') AS default_read_only
  `);
  const row = result.rows[0];
  if (!row?.name || !row.oid || !/^\d+$/.test(row.system_identifier) ||
    !/^\d+$/.test(row.server_version_num) ||
    !row.snapshot || !row.wal_lsn || !["on", "off"].includes(row.default_read_only)) {
    throw new Error("Enterprise cutover database identity is unavailable");
  }
  return {
    database: {
      name: row.name,
      oid: row.oid,
      systemIdentifier: row.system_identifier,
      serverVersionNum: row.server_version_num,
      inRecovery: row.in_recovery,
    },
    snapshot: row.snapshot,
    walLsn: row.wal_lsn,
    defaultTransactionReadOnly: row.default_read_only === "on",
  };
}

async function readMigrations(client: EnterpriseCutoverQueryClient) {
  const publicResult = await client.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations ORDER BY version",
  );
  const enterpriseResult = await client.query<{ id: string; checksum: string }>(
    "SELECT id, checksum FROM enterprise.schema_migrations ORDER BY id",
  );
  return {
    publicMigrations: publicResult.rows.map((row) => row.version),
    enterpriseMigrations: enterpriseResult.rows.map((row) => ({
      id: row.id,
      checksum: row.checksum,
    })),
  };
}

async function readTableNames(client: EnterpriseCutoverQueryClient) {
  const result = await client.query<{ table_schema: string; table_name: string }>(`
    SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_schema = ANY($1::text[]) AND table_type = 'BASE TABLE'
      AND table_name <> 'schema_migrations'
    ORDER BY table_schema, table_name
  `, [[...schemas]]);
  const names = result.rows.map((row) => {
    if (!schemas.includes(row.table_schema as typeof schemas[number]) ||
      !identifier(row.table_name)) {
      throw new Error("Invalid enterprise cutover table discovery result");
    }
    return `${row.table_schema}.${row.table_name}`;
  });
  if (new Set(names).size !== names.length) {
    throw new Error("Duplicate enterprise cutover table discovery result");
  }
  return names;
}

async function readTableManifest(
  client: EnterpriseCutoverQueryClient,
  tableName: string,
  pageSize: number,
): Promise<EnterpriseDatabaseTableManifest> {
  const [schema, table] = tableName.split(".");
  if (!schemas.includes(schema as typeof schemas[number]) || !identifier(table)) {
    throw new Error(`Invalid enterprise cutover table: ${tableName}`);
  }
  const primaryKey = await readPrimaryKey(client, schema!, table!);
  if (primaryKey.length === 0) {
    throw new Error(`Enterprise cutover table has no primary key: ${tableName}`);
  }
  const digest = createHash("sha256");
  let cursor: unknown[] | undefined;
  let lastKey: unknown[] | undefined;
  let count = 0;
  while (true) {
    const page = await readPage(client, schema!, table!, primaryKey, cursor, pageSize);
    for (const row of page.rows) {
      const json = row.record_json;
      if (typeof json !== "string") throw new Error(`Invalid cutover row: ${tableName}`);
      digest.update(String(Buffer.byteLength(json))).update(":").update(json);
    }
    count += page.rows.length;
    if (!Number.isSafeInteger(count)) throw new Error("Enterprise cutover row count overflow");
    if (page.rows.length > 0) {
      lastKey = primaryKey.map((_, index) => page.rows.at(-1)![`key_${index}`]);
    }
    if (page.rows.length < pageSize) break;
    cursor = lastKey;
  }
  return {
    primaryKey,
    count,
    sha256: digest.digest("hex"),
    ...(lastKey ? { lastKeySha256: sha256(stableJson(lastKey)) } : {}),
  };
}

async function readPrimaryKey(
  client: EnterpriseCutoverQueryClient,
  schema: string,
  table: string,
) {
  const result = await client.query<{ column_name: string }>(`
    SELECT attribute_record.attname AS column_name
    FROM pg_index index_record
    JOIN pg_class table_record ON table_record.oid = index_record.indrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    JOIN LATERAL unnest(index_record.indkey) WITH ORDINALITY
      AS key_record(attnum, key_order) ON true
    JOIN pg_attribute attribute_record ON attribute_record.attrelid = table_record.oid
      AND attribute_record.attnum = key_record.attnum
    WHERE namespace_record.nspname = $1 AND table_record.relname = $2
      AND index_record.indisprimary
    ORDER BY key_record.key_order
  `, [schema, table]);
  return result.rows.map((row) => row.column_name);
}

function readPage(
  client: EnterpriseCutoverQueryClient,
  schema: string,
  table: string,
  primaryKey: string[],
  cursor: unknown[] | undefined,
  pageSize: number,
) {
  const columns = primaryKey.map((column) => `source_row.${quote(column)}`);
  const keys = columns.map((column, index) => `${column} AS ${quote(`key_${index}`)}`);
  const values = cursor ? [...cursor, pageSize] : [pageSize];
  const where = cursor
    ? `WHERE (${columns.join(", ")}) > (${
        cursor.map((_, index) => `$${index + 1}`).join(", ")
      })`
    : "";
  return client.query<Record<string, unknown> & { record_json: unknown }>(`
    SELECT to_jsonb(source_row)::text AS record_json, ${keys.join(", ")}
    FROM ${quote(schema)}.${quote(table)} AS source_row
    ${where}
    ORDER BY ${columns.join(", ")}
    LIMIT $${values.length}
  `, values);
}

function identifier(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-z_][a-z0-9_]*$/.test(value);
}
function quote(value: string) {
  if (!identifier(value)) throw new Error("Invalid enterprise cutover identifier");
  return `"${value}"`;
}
function assertLogicalId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(value)) {
    throw new Error("Invalid enterprise cutover logical database ID");
  }
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function stableEnterpriseCutoverJson(value: unknown): string {
  return stableJson(value);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
