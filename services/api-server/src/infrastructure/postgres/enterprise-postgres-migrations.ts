import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface EnterprisePostgresMigration {
  id: string;
  checksum: string;
  up: string;
  down: string;
}

export interface PostgresMigrationClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

const migrationsDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));

export function loadEnterprisePostgresMigrations(
  directory = migrationsDirectory,
): EnterprisePostgresMigration[] {
  const ids = readdirSync(directory)
    .filter((name) => name.endsWith(".up.sql"))
    .map((name) => name.slice(0, -".up.sql".length))
    .sort();
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate migration id");
  return ids.map((id) => {
    const up = readFileSync(`${directory}/${id}.up.sql`, "utf8");
    const down = readFileSync(`${directory}/${id}.down.sql`, "utf8");
    const checksum = createHash("sha256")
      .update(up)
      .update("\0")
      .update(down)
      .digest("hex");
    return { id, checksum, up, down };
  });
}

export async function migrateEnterprisePostgres(
  client: PostgresMigrationClient,
  migrations = loadEnterprisePostgresMigrations(),
) {
  assertOrdered(migrations);
  await client.query("BEGIN");
  try {
    await prepareMigrationTable(client);
    const applied = await readApplied(client);
    for (const migration of migrations) {
      const checksum = applied.get(migration.id);
      if (checksum && checksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch: ${migration.id}`);
      }
      if (checksum) continue;
      await client.query(migration.up);
      await client.query(
        "INSERT INTO enterprise.schema_migrations(id, checksum) VALUES ($1, $2)",
        [migration.id, migration.checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function rollbackEnterprisePostgres(
  client: PostgresMigrationClient,
  migrations = loadEnterprisePostgresMigrations(),
) {
  assertOrdered(migrations);
  await client.query("BEGIN");
  try {
    await prepareMigrationTable(client);
    const applied = await readApplied(client);
    const migration = [...migrations].reverse().find(({ id }) => applied.has(id));
    if (!migration) {
      await client.query("COMMIT");
      return;
    }
    if (applied.get(migration.id) !== migration.checksum) {
      throw new Error(`Migration checksum mismatch: ${migration.id}`);
    }
    await client.query(
      "DELETE FROM enterprise.schema_migrations WHERE id = $1",
      [migration.id],
    );
    await client.query(migration.down);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function prepareMigrationTable(client: PostgresMigrationClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('enterprise-schema-migrations'))");
  await client.query("CREATE SCHEMA IF NOT EXISTS enterprise");
  await client.query(`
    CREATE TABLE IF NOT EXISTS enterprise.schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readApplied(client: PostgresMigrationClient) {
  const result = await client.query<{ id: string; checksum: string }>(
    "SELECT id, checksum FROM enterprise.schema_migrations ORDER BY id",
  );
  return new Map(result.rows.map(({ id, checksum }) => [id, checksum]));
}

function assertOrdered(migrations: readonly EnterprisePostgresMigration[]) {
  const ids = migrations.map(({ id }) => id);
  if (new Set(ids).size !== ids.length || ids.join() !== [...ids].sort().join()) {
    throw new Error("Migrations must have unique ascending ids");
  }
}
