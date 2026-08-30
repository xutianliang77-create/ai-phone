import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  enterpriseReleaseCapabilities,
  type EnterpriseReleaseCapability,
} from "@translation/contracts";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import { createEnterprisePostgresPool } from "./enterprise-postgres-client.js";
import { createEnterprisePostgresReleaseControlRuntime } from
  "./enterprise-postgres-release-control-runtime.js";

const databaseUrl = process.env.ENTERPRISE_TENANT_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("ENTERPRISE_TENANT_DATABASE_URL is required");
if (process.env.ENTERPRISE_RELEASE_ACCEPTANCE_MUTATION !== "true") {
  throw new Error("Set ENTERPRISE_RELEASE_ACCEPTANCE_MUTATION=true for the isolated test database");
}

const tenantA = requiredUuid(
  process.env.ENTERPRISE_RELEASE_ACCEPTANCE_TENANT_A, "TENANT_A",
);
const tenantB = requiredUuid(
  process.env.ENTERPRISE_RELEASE_ACCEPTANCE_TENANT_B, "TENANT_B",
);
if (tenantA === tenantB) throw new Error("Acceptance tenants must be distinct");
const capability = releaseCapability(
  process.env.ENTERPRISE_RELEASE_ACCEPTANCE_CAPABILITY ?? "support.agent",
);
const forgedCapability = enterpriseReleaseCapabilities.find(
  (candidate) => candidate !== capability,
)!;
const poolA = createEnterprisePostgresPool({ connectionString: databaseUrl, ssl: false });
const poolB = createEnterprisePostgresPool({ connectionString: databaseUrl, ssl: false });
const runtimeA = createEnterprisePostgresReleaseControlRuntime(poolA);
const runtimeB = createEnterprisePostgresReleaseControlRuntime(poolB);
const contextA = createEnterpriseTenantContext({
  tenantId: tenantA, actorUserId: "acct:operator-a", traceId: "trace-real-a",
});
const contextB = createEnterpriseTenantContext({
  tenantId: tenantB, actorUserId: "acct:operator-b", traceId: "trace-real-b",
});
const startedAt = Date.now();
const instant = (second: number) => new Date(startedAt + second * 1_000).toISOString();
const operationIds = Array.from({ length: 6 }, () => randomUUID());
const common = {
  tenantId: tenantA,
  capability,
  owner: "release-oncall",
  rolloutExpiresAt: new Date(startedAt + 7 * 86_400_000).toISOString(),
  failureThreshold: 2,
  actorId: "platform:release-operator",
  traceId: "trace-release-real-run",
};

try {
  const created = await runtimeA.changeReleaseControl({
    ...common, expectedVersion: 0, action: { type: "set_rollout", enabled: true },
    reason: "real PostgreSQL acceptance", operationId: operationIds[0]!, now: instant(1),
  });
  assert.equal(created.status, "updated");
  assert.equal(created.control.version, 1);

  const allowed = await runtimeA.evaluateReleaseControl({
    context: contextA, capability, now: instant(2),
  });
  assert.equal(allowed.status, "ready");
  assert.equal(allowed.decision.reason, "allowed");

  const foreignBefore = await runtimeB.listReleaseControls({ context: contextB });
  assert.equal(foreignBefore.status, "ready");
  assert.equal(foreignBefore.controls.length, 0);

  const failureOne = await runtimeA.recordReleaseOutcome({
    tenantId: tenantA, capability, outcome: "failure", probe: false,
    actorId: "worker:one", traceId: "trace-failure-one",
    operationId: operationIds[1]!, now: instant(3),
  });
  assert.equal(failureOne.status, "updated");
  assert.equal(failureOne.control.circuitState, "closed");
  assert.equal(failureOne.control.consecutiveFailures, 1);

  const duplicateInput = {
    tenantId: tenantA, capability, outcome: "failure" as const, probe: false,
    actorId: "worker:two", traceId: "trace-failure-two",
    operationId: operationIds[2]!, now: instant(4),
  };
  const concurrentDuplicate = await Promise.all([
    runtimeA.recordReleaseOutcome(duplicateInput),
    runtimeB.recordReleaseOutcome(duplicateInput),
  ]);
  assert.deepEqual(
    concurrentDuplicate.map(({ status }) => status).sort(),
    ["already_recorded", "updated"],
  );
  const opened = concurrentDuplicate.find(({ status }) => status === "updated");
  assert.equal(opened?.status === "updated" && opened.control.circuitState, "open");

  const openDecision = await runtimeA.evaluateReleaseControl({
    context: contextA, capability, now: instant(5),
  });
  assert.equal(openDecision.status, "ready");
  assert.equal(openDecision.decision.reason, "circuit_open");

  const probing = await runtimeA.changeReleaseControl({
    ...common, expectedVersion: 3, action: { type: "begin_probe" },
    reason: "operator probe", operationId: operationIds[3]!, now: instant(6),
  });
  assert.equal(probing.status, "updated");
  assert.equal(probing.control.circuitState, "half_open");

  const normalHalfOpen = await runtimeA.evaluateReleaseControl({
    context: contextA, capability, now: instant(7),
  });
  const probeHalfOpen = await runtimeA.evaluateReleaseControl({
    context: contextA, capability, now: instant(7), probe: true,
  });
  assert.equal(normalHalfOpen.status, "ready");
  assert.equal(normalHalfOpen.decision.reason, "probe_required");
  assert.equal(probeHalfOpen.status, "ready");
  assert.equal(probeHalfOpen.decision.reason, "allowed");

  const recovered = await runtimeA.recordReleaseOutcome({
    tenantId: tenantA, capability, outcome: "success", probe: true,
    actorId: "worker:probe", traceId: "trace-probe-success",
    operationId: operationIds[4]!, now: instant(8),
  });
  assert.equal(recovered.status, "updated");
  assert.equal(recovered.control.circuitState, "closed");
  assert.equal(recovered.control.consecutiveFailures, 0);

  const killed = await runtimeA.changeReleaseControl({
    ...common, expectedVersion: 5, action: { type: "set_kill_switch", active: true },
    reason: "operator isolation", operationId: operationIds[5]!, now: instant(9),
  });
  assert.equal(killed.status, "updated");
  const killedDecision = await runtimeA.evaluateReleaseControl({
    context: contextA, capability, now: instant(10),
  });
  assert.equal(killedDecision.status, "ready");
  assert.equal(killedDecision.decision.reason, "kill_switch_active");

  const databaseEvidence = await verifyDatabaseBoundaries(databaseUrl);
  assert.equal(databaseEvidence.foreignReadCount, 0);
  assert.equal(databaseEvidence.foreignInsertSqlState, "42501");
  assert.equal(databaseEvidence.eventMutationSqlState, "55000");
  assert.equal(databaseEvidence.eventCount, 6);
  assert.equal(databaseEvidence.publicMigrations, 31);
  assert.equal(databaseEvidence.enterpriseMigrations, 55);
  assert.equal(databaseEvidence.superuser, false);
  assert.equal(databaseEvidence.bypassRls, false);

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    postgres: databaseEvidence.version,
    migrationCounts: {
      public: databaseEvidence.publicMigrations,
      enterprise: databaseEvidence.enterpriseMigrations,
    },
    rlsRole: { superuser: false, bypassRls: false },
    tenantIsolation: {
      tenantBVisibleControls: foreignBefore.controls.length,
      forgedTenantReadRows: databaseEvidence.foreignReadCount,
      forgedTenantInsertSqlState: databaseEvidence.foreignInsertSqlState,
    },
    circuit: {
      duplicateStatuses: concurrentDuplicate.map(({ status }) => status).sort(),
      openReason: openDecision.decision.reason,
      halfOpenNormalReason: normalHalfOpen.decision.reason,
      halfOpenProbeReason: probeHalfOpen.decision.reason,
      recoveredState: recovered.control.circuitState,
      killReason: killedDecision.decision.reason,
    },
    evidence: {
      appendOnlyMutationSqlState: databaseEvidence.eventMutationSqlState,
      eventCount: databaseEvidence.eventCount,
      finalVersion: killed.control.version,
    },
  })}\n`);
} finally {
  await Promise.all([poolA.end(), poolB.end()]);
}

async function verifyDatabaseBoundaries(connectionString: string) {
  const client = new pg.Client({ connectionString, ssl: false });
  await client.connect();
  try {
    const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    const version = await client.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    const publicMigrations = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM ai_phone.schema_migrations",
    );
    const enterpriseMigrations = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM enterprise.schema_migrations",
    );
    await beginTenant(client, tenantB);
    const foreign = await client.query(
      "SELECT capability FROM enterprise.release_controls WHERE tenant_id = $1",
      [tenantA],
    );
    await client.query("COMMIT");

    let foreignInsertSqlState = "missing";
    await beginTenant(client, tenantB);
    try {
      await client.query(`
        INSERT INTO enterprise.release_controls(
          tenant_id, capability, enabled, kill_switch_active, circuit_state,
          consecutive_failures, failure_threshold, owner, rollout_expires_at,
          version, created_at, updated_at
        ) VALUES ($1, $2, true, false, 'closed', 0, 2,
          'forged', $3, 1, now(), now())
      `, [tenantA, forgedCapability, common.rolloutExpiresAt]);
    } catch (error) {
      foreignInsertSqlState = sqlState(error);
    }
    await client.query("ROLLBACK");

    let eventMutationSqlState = "missing";
    await beginTenant(client, tenantA);
    try {
      await client.query(`
        UPDATE enterprise.release_control_events SET reason = 'tampered'
        WHERE tenant_id = $1
      `, [tenantA]);
    } catch (error) {
      eventMutationSqlState = sqlState(error);
    }
    await client.query("ROLLBACK");

    await beginTenant(client, tenantA);
    const events = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM enterprise.release_control_events WHERE tenant_id = $1 AND capability = $2",
      [tenantA, capability],
    );
    await client.query("COMMIT");
    return {
      version: version.rows[0]?.version,
      publicMigrations: Number(publicMigrations.rows[0]?.count),
      enterpriseMigrations: Number(enterpriseMigrations.rows[0]?.count),
      superuser: role.rows[0]?.rolsuper,
      bypassRls: role.rows[0]?.rolbypassrls,
      foreignReadCount: foreign.rowCount ?? 0,
      foreignInsertSqlState,
      eventMutationSqlState,
      eventCount: Number(events.rows[0]?.count),
    };
  } finally {
    await client.end();
  }
}

async function beginTenant(client: pg.Client, tenantId: string) {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  await client.query("SELECT set_config('app.user_id', 'acct:boundary-test', true)");
}

function sqlState(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "unknown";
}

function requiredUuid(value: string | undefined, name: string) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`ENTERPRISE_RELEASE_ACCEPTANCE_${name} must be a UUID`);
  }
  return value;
}

function releaseCapability(value: string): EnterpriseReleaseCapability {
  if (!enterpriseReleaseCapabilities.includes(value as EnterpriseReleaseCapability)) {
    throw new Error("ENTERPRISE_RELEASE_ACCEPTANCE_CAPABILITY is invalid");
  }
  return value as EnterpriseReleaseCapability;
}
