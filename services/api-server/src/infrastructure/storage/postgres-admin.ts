import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import {
  buildPostgresPoolConfig,
  getPostgresProjectionConfig,
} from "./postgres-projection-config.js";
import {
  auditPostgresProjectionSnapshot,
  importPostgresProjectionSnapshot,
} from "./postgres-cutover-audit.js";
import {
  comparePostgresMigrations,
  expectedPostgresMigrations,
} from "./postgres-schema-manifest.js";
import { upgradePostgresCutoverEvidence } from
  "./postgres-cutover-evidence-upgrade.js";
import { assertPostgresPrimaryStartup } from "./postgres-primary-startup.js";

const command = process.argv[2];
if (!["migrate", "check", "import", "audit", "startup-check",
  "upgrade-evidence"].includes(command ?? "")) {
  throw new Error(
    "Usage: postgres-admin.ts <migrate|check|import|audit|startup-check|" +
      "upgrade-evidence>",
  );
}

const pool = new Pool(buildPostgresPoolConfig({
  ...getPostgresProjectionConfig(),
  enabled: true,
}));

try {
  if (command === "migrate") await migrate();
  else if (command === "check") await check();
  else if (command === "import") await importSnapshot();
  else if (command === "audit") await auditSnapshot();
  else if (command === "startup-check") await startupCheck();
  else await upgradeEvidence();
} finally {
  await pool.end();
}

async function startupCheck() {
  const result = await assertPostgresPrimaryStartup(pool);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function upgradeEvidence() {
  const result = await upgradePostgresCutoverEvidence(pool);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function importSnapshot() {
  const client = await pool.connect();
  try {
    const result = await importPostgresProjectionSnapshot(client);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    client.release();
  }
}

async function auditSnapshot() {
  const client = await pool.connect();
  try {
    const result = await auditPostgresProjectionSnapshot(client);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "matched") process.exitCode = 2;
  } finally {
    client.release();
  }
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('ai_phone_schema_migrations'))");
    const applied = await appliedMigrations(client);
    for (const file of migrationFiles()) {
      const version = file.split("/").at(-1)!.replace(/\.sql$/, "");
      if (applied.has(version)) {
        process.stdout.write(`skipped ${version}\n`);
        continue;
      }
      await client.query(readFileSync(file, "utf8"));
      process.stdout.write(`applied ${file.split("/").at(-1)}\n`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('ai_phone_schema_migrations'))")
      .catch(() => undefined);
    client.release();
  }
}

async function appliedMigrations(client: PoolClient) {
  const exists = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('ai_phone.schema_migrations')::text AS table_name",
  );
  if (!exists.rows[0]?.table_name) return new Set<string>();
  const rows = await client.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations",
  );
  return new Set(rows.rows.map((row) => row.version));
}

async function check() {
  const result = await pool.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations ORDER BY version",
  );
  const applied = new Set(result.rows.map((row) => row.version));
  migrationFiles();
  const comparison = comparePostgresMigrations([...applied]);
  if (comparison.missing.length > 0 || comparison.extra.length > 0) {
    throw new Error(
      `PostgreSQL migration mismatch: missing=${comparison.missing.join(",")} ` +
      `extra=${comparison.extra.join(",")}`,
    );
  }
  process.stdout.write(
    `PostgreSQL schema ready (${expectedPostgresMigrations.length} migrations)\n`,
  );
}

function migrationFiles() {
  const directory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../infra/postgres/migrations",
  );
  const files = readdirSync(directory)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => resolve(directory, name));
  const versions = files.map((file) => file.split("/").at(-1)!.replace(/\.sql$/, ""));
  if (JSON.stringify(versions) !== JSON.stringify([...expectedPostgresMigrations])) {
    throw new Error("PostgreSQL migration files do not match the runtime manifest");
  }
  return files;
}
