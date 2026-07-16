import {
  assertEnterpriseDataManifestMatch,
  enterpriseDataManifest,
  type EnterpriseDataManifest,
  type EnterpriseDataSnapshot,
} from "./enterprise-postgres-data-manifest.js";
import {
  readEnterprisePostgresData,
} from "./enterprise-postgres-data-read.js";
import {
  writeEnterprisePostgresData,
} from "./enterprise-postgres-data-write.js";
import type {
  PostgresMigrationClient,
} from "./enterprise-postgres-migrations.js";

interface EnterpriseDataTransferDependencies {
  read?: typeof readEnterprisePostgresData;
  write?: typeof writeEnterprisePostgresData;
}

export async function importEnterprisePostgresData(
  client: PostgresMigrationClient,
  source: EnterpriseDataSnapshot,
  dependencies: EnterpriseDataTransferDependencies = {},
): Promise<EnterpriseDataManifest> {
  const read = dependencies.read ?? readEnterprisePostgresData;
  const write = dependencies.write ?? writeEnterprisePostgresData;
  const expected = enterpriseDataManifest(source);
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('enterprise-data-import'))",
    );
    const before = enterpriseDataManifest(await read(client));
    if (before.totalCount !== 0) {
      throw new Error("Enterprise PostgreSQL import target is not empty");
    }
    await write(client, source);
    const actual = enterpriseDataManifest(await read(client));
    assertEnterpriseDataManifestMatch(expected, actual);
    await client.query("COMMIT");
    return actual;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function reconcileEnterprisePostgresData(
  client: PostgresMigrationClient,
  source: EnterpriseDataSnapshot,
  dependencies: EnterpriseDataTransferDependencies = {},
): Promise<EnterpriseDataManifest> {
  const read = dependencies.read ?? readEnterprisePostgresData;
  const expected = enterpriseDataManifest(source);
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    const actual = enterpriseDataManifest(await read(client));
    assertEnterpriseDataManifestMatch(expected, actual);
    await client.query("COMMIT");
    return actual;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
