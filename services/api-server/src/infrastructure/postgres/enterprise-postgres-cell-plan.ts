export interface EnterpriseCellQueryClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface EnterpriseCellTablePlan {
  name: string;
  schema: "ai_phone" | "enterprise";
  table: string;
  primaryKey: string[];
  insertColumns: string[];
  dependencies: string[];
  selector: "tenant_root" | "tenant_id" | "communication_scope";
  derived: boolean;
}

export async function discoverEnterpriseCellTables(
  client: EnterpriseCellQueryClient,
): Promise<EnterpriseCellTablePlan[]> {
  const columns = await client.query<{
    table_schema: string; table_name: string; columns: string[];
    insert_columns: string[];
  }>(`
    SELECT table_schema, table_name,
      array_agg(column_name ORDER BY ordinal_position) AS columns,
      array_agg(column_name ORDER BY ordinal_position)
        FILTER (WHERE is_generated = 'NEVER') AS insert_columns
    FROM information_schema.columns column_record
    JOIN information_schema.tables table_record
      USING (table_schema, table_name)
    WHERE table_schema = ANY($1::text[]) AND table_record.table_type = 'BASE TABLE'
    GROUP BY table_schema, table_name
    ORDER BY table_schema, table_name
  `, [["ai_phone", "enterprise"]]);
  const primaryKeys = await client.query<{
    table_schema: string; table_name: string; columns: string[];
  }>(`
    SELECT namespace_record.nspname AS table_schema,
      table_record.relname AS table_name,
      array_agg(attribute_record.attname ORDER BY key_record.key_order) AS columns
    FROM pg_index index_record
    JOIN pg_class table_record ON table_record.oid = index_record.indrelid
    JOIN pg_namespace namespace_record
      ON namespace_record.oid = table_record.relnamespace
    JOIN LATERAL unnest(index_record.indkey) WITH ORDINALITY
      AS key_record(attnum, key_order) ON true
    JOIN pg_attribute attribute_record
      ON attribute_record.attrelid = table_record.oid
      AND attribute_record.attnum = key_record.attnum
    WHERE namespace_record.nspname = ANY($1::text[])
      AND index_record.indisprimary
    GROUP BY namespace_record.nspname, table_record.relname
  `, [["ai_phone", "enterprise"]]);
  const foreignKeys = await client.query<{
    child_schema: string; child_table: string;
    parent_schema: string; parent_table: string; is_deferrable: boolean;
  }>(`
    SELECT child_namespace.nspname AS child_schema,
      child_table.relname AS child_table,
      parent_namespace.nspname AS parent_schema,
      parent_table.relname AS parent_table,
      constraint_record.condeferrable AS is_deferrable
    FROM pg_constraint constraint_record
    JOIN pg_class child_table ON child_table.oid = constraint_record.conrelid
    JOIN pg_namespace child_namespace
      ON child_namespace.oid = child_table.relnamespace
    JOIN pg_class parent_table ON parent_table.oid = constraint_record.confrelid
    JOIN pg_namespace parent_namespace
      ON parent_namespace.oid = parent_table.relnamespace
    WHERE constraint_record.contype = 'f'
      AND child_namespace.nspname = ANY($1::text[])
      AND parent_namespace.nspname = ANY($1::text[])
  `, [["ai_phone", "enterprise"]]);
  const keyMap = new Map(primaryKeys.rows.map((row) => [
    `${row.table_schema}.${row.table_name}`, row.columns,
  ]));
  const candidates = columns.rows.flatMap((row): EnterpriseCellTablePlan[] => {
    const schema = schemaName(row.table_schema);
    if (!schema || row.table_name === "schema_migrations") return [];
    if (schema === "enterprise" && globalEnterpriseTables.has(row.table_name)) {
      return [];
    }
    const selector = selectorFor(schema, row.table_name, row.columns);
    if (!selector) {
      if (schema === "enterprise") {
        throw new Error(`Enterprise cell table has no tenant selector: ${row.table_name}`);
      }
      return [];
    }
    const name = `${schema}.${row.table_name}`;
    const primaryKey = keyMap.get(name);
    if (!primaryKey?.length) {
      throw new Error(`Enterprise cell table has no primary key: ${name}`);
    }
    if (!row.insert_columns?.length) {
      throw new Error(`Enterprise cell table has no insertable columns: ${name}`);
    }
    return [{ name, schema, table: row.table_name, primaryKey,
      insertColumns: row.insert_columns,
      dependencies: [], selector,
      derived: derivedEnterpriseTables.has(name) }];
  });
  const selected = new Set(candidates.map((table) => table.name));
  for (const relation of foreignKeys.rows) {
    const child = `${relation.child_schema}.${relation.child_table}`;
    const parent = `${relation.parent_schema}.${relation.parent_table}`;
    if (relation.is_deferrable || !selected.has(child) || !selected.has(parent) ||
      child === parent) continue;
    candidates.find((table) => table.name === child)!.dependencies.push(parent);
  }
  return topologicalTables(candidates);
}

const globalEnterpriseTables = new Set([
  "control_plane_instances",
  "control_plane_pending_work",
  "cell_admission_policies",
  "cell_admission_state",
  "cell_tenant_admission_state",
  "tenant_admission_requests",
]);

const derivedEnterpriseTables = new Set([
  "enterprise.platform_pending_work",
]);

function selectorFor(schema: "ai_phone" | "enterprise", table: string, columns: string[]) {
  if (schema === "enterprise" && table === "tenants") return "tenant_root" as const;
  if (schema === "enterprise" && columns.includes("tenant_id")) return "tenant_id" as const;
  if (schema === "ai_phone" && columns.includes("scope_type") && columns.includes("scope_id")) {
    return "communication_scope" as const;
  }
  return null;
}

function topologicalTables(tables: EnterpriseCellTablePlan[]) {
  const remaining = new Map(tables.map((table) => [table.name, table]));
  const ordered: EnterpriseCellTablePlan[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((table) =>
      table.dependencies.every((dependency) => !remaining.has(dependency)))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!ready.length) {
      throw new Error(`Enterprise cell table dependency cycle: ${[...remaining.keys()].join(",")}`);
    }
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table.name);
    }
  }
  return ordered;
}

function schemaName(value: string): "ai_phone" | "enterprise" | null {
  return value === "ai_phone" || value === "enterprise" ? value : null;
}
