import type { EnterpriseCellQueryClient, EnterpriseCellTablePlan } from
  "./enterprise-postgres-cell-plan.js";

export async function prepareEnterpriseCellRollbackTarget(
  client: EnterpriseCellQueryClient,
  plan: EnterpriseCellTablePlan[],
  tenantId: string,
) {
  await assertSuperuser(client);
  await assertUserTriggersEnabled(client, plan);
  await setUserTriggers(client, plan, false);
  for (const table of [...plan].reverse()) {
    await client.query(`DELETE FROM ${quote(table.schema)}.${quote(table.table)}
      WHERE ${selectorSql(table.selector)}`, [tenantId]);
  }
}

export function restoreEnterpriseCellRollbackTriggers(
  client: EnterpriseCellQueryClient,
  plan: EnterpriseCellTablePlan[],
) {
  return setUserTriggers(client, plan, true);
}

async function assertSuperuser(client: EnterpriseCellQueryClient) {
  const result = await client.query<{ is_superuser: boolean }>(
    "SELECT rolsuper AS is_superuser FROM pg_roles WHERE rolname = current_user",
  );
  if (!result.rows[0]?.is_superuser) {
    throw new Error("Enterprise cell rollback replacement requires an audited superuser");
  }
}

async function assertUserTriggersEnabled(
  client: EnterpriseCellQueryClient,
  plan: EnterpriseCellTablePlan[],
) {
  const result = await client.query<{ name: string; state: string }>(`
    SELECT namespace_record.nspname || '.' || table_record.relname AS name,
      trigger_record.tgenabled AS state
    FROM pg_trigger trigger_record
    JOIN pg_class table_record ON table_record.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    WHERE NOT trigger_record.tgisinternal
      AND namespace_record.nspname || '.' || table_record.relname = ANY($1::text[])
      AND trigger_record.tgenabled <> 'O'
  `, [plan.map((table) => table.name)]);
  if (result.rows.length) {
    throw new Error("Enterprise cell rollback found nonstandard user trigger state");
  }
}

async function setUserTriggers(
  client: EnterpriseCellQueryClient,
  plan: EnterpriseCellTablePlan[],
  enabled: boolean,
) {
  for (const table of plan) {
    await client.query(
      `ALTER TABLE ${quote(table.schema)}.${quote(table.table)} ` +
        `${enabled ? "ENABLE" : "DISABLE"} TRIGGER USER`,
    );
  }
}

function selectorSql(selector: EnterpriseCellTablePlan["selector"]) {
  if (selector === "tenant_root") return "id = $1::uuid";
  if (selector === "tenant_id") return "tenant_id = $1::uuid";
  return "scope_type = 'tenant' AND scope_id = $1";
}
function quote(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Invalid cell rollback identifier");
  return `"${value}"`;
}
