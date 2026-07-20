import { createHash } from "node:crypto";
import { stableEnterpriseCutoverJson as stableJson } from
  "./enterprise-postgres-database-manifest.js";
import type { EnterpriseCellQueryClient, EnterpriseCellTablePlan } from
  "./enterprise-postgres-cell-plan.js";
export { discoverEnterpriseCellTables } from "./enterprise-postgres-cell-plan.js";
export type { EnterpriseCellQueryClient, EnterpriseCellTablePlan } from
  "./enterprise-postgres-cell-plan.js";

export interface EnterpriseCellTableManifest {
  primaryKey: string[];
  count: number;
  sha256: string;
}

export interface EnterpriseCellDataManifest {
  formatVersion: 1;
  logicalId: string;
  tenantId: string;
  database: {
    name: string;
    oid: string;
    systemIdentifier: string;
    serverVersionNum: string;
  };
  route: {
    homeRegion: string;
    cellId: string;
    version: number;
    status: string;
  };
  publicMigrations: string[];
  enterpriseMigrations: Array<{ id: string; checksum: string }>;
  tables: Record<string, EnterpriseCellTableManifest>;
  objectReferences: { count: number; sha256: string };
  totalCount: number;
  sha256: string;
  capturedAt: string;
}

export interface EnterpriseCellPageRecord {
  json: string;
  canonicalJson: string;
  value: Record<string, unknown>;
}

export async function collectEnterpriseCellManifestInTransaction(
  client: EnterpriseCellQueryClient,
  plan: EnterpriseCellTablePlan[],
  tenantId: string,
  logicalId: string,
  options: { pageSize?: number } = {},
): Promise<EnterpriseCellDataManifest> {
  assertUuid(tenantId);
  assertLogicalId(logicalId);
  const pageSize = options.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5_000) {
    throw new Error("Enterprise cell page size must be 1-5000");
  }
  await assertMaintenanceRole(client);
  const database = await readDatabaseIdentity(client);
  const migrations = await readMigrations(client);
  const tables: Record<string, EnterpriseCellTableManifest> = {};
  const objectDigest = createHash("sha256");
  let objectCount = 0;
  let route: EnterpriseCellDataManifest["route"] | undefined;
  for (const table of plan) {
    const digest = createHash("sha256");
    let count = 0;
    await forEachEnterpriseCellPage(client, table, tenantId, pageSize, (records) => {
      for (const record of records) {
        if (table.name === "enterprise.tenants") route = tenantRoute(record.value);
        const json = record.canonicalJson;
        digest.update(String(Buffer.byteLength(json))).update(":").update(json);
        for (const reference of objectReferences(record.value)) {
          const value = `${table.name}:${stableJson(reference)}`;
          objectDigest.update(String(Buffer.byteLength(value))).update(":").update(value);
          objectCount += 1;
        }
      }
      count += records.length;
    });
    tables[table.name] = { primaryKey: table.primaryKey, count,
      sha256: digest.digest("hex") };
  }
  if (!route) throw new Error("Enterprise cell tenant does not exist");
  const totalCount = Object.values(tables).reduce((sum, table) => sum + table.count, 0);
  const objectReferencesManifest = {
    count: objectCount,
    sha256: objectDigest.digest("hex"),
  };
  const content = { publicMigrations: migrations.publicMigrations,
    enterpriseMigrations: migrations.enterpriseMigrations, tables,
    objectReferences: objectReferencesManifest, totalCount };
  return { formatVersion: 1, logicalId, tenantId, database, route,
    ...migrations, tables, objectReferences: objectReferencesManifest, totalCount,
    sha256: sha256(stableJson(content)), capturedAt: new Date().toISOString() };
}

export async function forEachEnterpriseCellPage(
  client: EnterpriseCellQueryClient,
  table: EnterpriseCellTablePlan,
  tenantId: string,
  pageSize: number,
  consume: (records: EnterpriseCellPageRecord[]) => void | Promise<void>,
) {
  let cursor: unknown[] | undefined;
  while (true) {
    const page = await readPage(client, table, tenantId, cursor, pageSize);
    const records = page.rows.map((row) => {
      if (typeof row.record_json !== "string" ||
        typeof row.canonical_json !== "string") {
        throw new Error(`Enterprise cell row is invalid: ${table.name}`);
      }
      return { json: row.record_json, canonicalJson: row.canonical_json,
        value: parseRecord(row.record_json, table.name) };
    });
    await consume(records);
    if (page.rows.length < pageSize) return;
    cursor = table.primaryKey.map((_, index) => page.rows.at(-1)![`key_${index}`]);
  }
}

export function compareEnterpriseCellManifests(
  source: EnterpriseCellDataManifest,
  target: EnterpriseCellDataManifest,
) {
  const names = [...new Set([...Object.keys(source.tables), ...Object.keys(target.tables)])]
    .sort();
  const mismatchedTables = names.filter((name) => {
    const left = source.tables[name];
    const right = target.tables[name];
    return !left || !right || left.count !== right.count || left.sha256 !== right.sha256 ||
      stableJson(left.primaryKey) !== stableJson(right.primaryKey);
  });
  const routeMatches = source.route.homeRegion === target.route.homeRegion &&
    source.route.status === target.route.status &&
    (source.route.cellId === target.route.cellId
      ? source.route.version === target.route.version
      : target.route.version === source.route.version + 1);
  if (!routeMatches) mismatchedTables.unshift("enterprise.tenants$route");
  const matched = source.tenantId === target.tenantId && source.sha256 === target.sha256 &&
    source.objectReferences.count === target.objectReferences.count &&
    source.objectReferences.sha256 === target.objectReferences.sha256 &&
    mismatchedTables.length === 0;
  return { status: matched ? "matched" as const : "mismatch" as const,
    mismatchedTables, sourceSha256: source.sha256, targetSha256: target.sha256 };
}

function readPage(
  client: EnterpriseCellQueryClient,
  table: EnterpriseCellTablePlan,
  tenantId: string,
  cursor: unknown[] | undefined,
  pageSize: number,
) {
  const keys = table.primaryKey.map((column) => `source_row.${quote(column)}`);
  const keyAliases = keys.map((column, index) => `${column} AS ${quote(`key_${index}`)}`);
  const cursorSql = cursor
    ? `AND (${keys.join(", ")}) > (${cursor.map((_, index) => `$${index + 2}`).join(", ")})`
    : "";
  const values = [tenantId, ...(cursor ?? []), pageSize];
  return client.query<Record<string, unknown> & {
    record_json: unknown; canonical_json: unknown;
  }>(`
    SELECT to_jsonb(source_row)::text AS record_json,
      ${canonicalJsonSql(table.name)} AS canonical_json, ${keyAliases.join(", ")}
    FROM ${quote(table.schema)}.${quote(table.table)} AS source_row
    WHERE ${selectorSql(table.selector)} ${cursorSql}
    ORDER BY ${keys.join(", ")}
    LIMIT $${values.length}
  `, values);
}

async function assertMaintenanceRole(client: EnterpriseCellQueryClient) {
  const result = await client.query<{ is_superuser: boolean; bypass_rls: boolean }>(`
    SELECT rolsuper AS is_superuser, rolbypassrls AS bypass_rls
    FROM pg_roles WHERE rolname = current_user
  `);
  if (!result.rows[0] ||
    (!result.rows[0].is_superuser && !result.rows[0].bypass_rls)) {
    throw new Error("Enterprise cell migration requires an audited maintenance role");
  }
}

async function readDatabaseIdentity(client: EnterpriseCellQueryClient) {
  const result = await client.query<{ name: string; oid: string;
    system_identifier: string; server_version_num: string }>(`
    SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
      (pg_control_system()).system_identifier::text AS system_identifier,
      current_setting('server_version_num') AS server_version_num
  `);
  const row = result.rows[0];
  if (!row?.name || !/^\d+$/.test(row.oid) || !/^\d+$/.test(row.system_identifier) ||
    !/^\d+$/.test(row.server_version_num)) {
    throw new Error("Enterprise cell database identity is unavailable");
  }
  return { name: row.name, oid: row.oid, systemIdentifier: row.system_identifier,
    serverVersionNum: row.server_version_num };
}

async function readMigrations(client: EnterpriseCellQueryClient) {
  const publicResult = await client.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations ORDER BY version",
  );
  const enterpriseResult = await client.query<{ id: string; checksum: string }>(
    "SELECT id, checksum FROM enterprise.schema_migrations ORDER BY id",
  );
  return { publicMigrations: publicResult.rows.map((row) => row.version),
    enterpriseMigrations: enterpriseResult.rows.map((row) => ({
      id: row.id, checksum: row.checksum,
    })) };
}

function selectorSql(selector: EnterpriseCellTablePlan["selector"]) {
  if (selector === "tenant_root") return "source_row.id = $1::uuid";
  if (selector === "tenant_id") return "source_row.tenant_id = $1::uuid";
  return "source_row.scope_type = 'tenant' AND source_row.scope_id = $1";
}

function canonicalJsonSql(table: string) {
  if (table === "enterprise.tenants") {
    return `(to_jsonb(source_row) || jsonb_build_object(
      'cell_id', '$cell', 'version', '$route_version',
      'updated_at', '$route_updated_at'))::text`;
  }
  if (table === "enterprise.platform_pending_work") {
    return `(to_jsonb(source_row) || jsonb_build_object(
      'cell_id', '$cell',
      'coordination_owner', '$coordination_owner',
      'coordination_generation', '$coordination_generation',
      'coordination_lease_expires_at', '$coordination_lease_expires_at'
    ))::text`;
  }
  return "to_jsonb(source_row)::text";
}

function tenantRoute(record: Record<string, unknown>) {
  const version = Number(record.version);
  if (typeof record.home_region !== "string" || typeof record.cell_id !== "string" ||
    typeof record.status !== "string" || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Enterprise cell tenant route is invalid");
  }
  return { homeRegion: record.home_region, cellId: record.cell_id,
    version, status: record.status };
}

function objectReferences(record: Record<string, unknown>) {
  const entries = Object.entries(record);
  const referenceEntries = entries.filter(([key, value]) => value !== null &&
    value !== "" &&
    /(?:object|artifact).*(?:id|key|ref|uri)|storage_(?:key|uri)/i.test(key));
  if (!referenceEntries.length) return [];
  const evidenceEntries = entries.filter(([key, value]) => value !== null &&
    value !== "" &&
    /(?:sha256|content_hash|size_bytes|content_type|etag|storage_version_id)$/i.test(key));
  return [Object.fromEntries([...referenceEntries, ...evidenceEntries])];
}

function parseRecord(value: unknown, table: string): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Enterprise cell row is invalid: ${table}`);
  }
}
function quote(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Invalid cell migration identifier");
  return `"${value}"`;
}
function assertUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)) throw new Error("Enterprise cell tenant ID must be a UUID");
}
function assertLogicalId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(value)) {
    throw new Error("Enterprise cell logical database ID is invalid");
  }
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
