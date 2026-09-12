import { randomUUID } from "node:crypto";
import { initializeRepositoryRuntime } from "./repository-runtime.js";
import {
  createSession,
  deleteSession,
} from "../../modules/sessions/sessions-runtime.repository.js";
import { observePublicRuntime } from
  "../../modules/sessions/public-session-runtime.service.js";
import { claimPublicRecoveryOwnership } from
  "../../modules/sessions/public-recovery-ownership.service.js";
import type { SessionRecord } from "../../modules/sessions/session-record.js";

const acceptanceFlag = "POSTGRES_RECOVERY_OWNERSHIP_ACCEPTANCE";
const expectedDatabase = "ai_phone_staging";
const deploymentId = "recovery-owner-staging-acceptance";
const aggregateType = "communication_session";

if (process.env[acceptanceFlag] !== "1") {
  throw new Error(`Set ${acceptanceFlag}=1 to run recovery ownership acceptance`);
}

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error("POSTGRES_URL is required");
if (new URL(connectionString).pathname.replace(/^\//, "") !== expectedDatabase) {
  throw new Error("Recovery ownership acceptance refuses a non-staging database");
}

const now = new Date();
const runId = `recovery-owner-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const previousDeployment = process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
process.env.API_RESULT_SYNC_DEPLOYMENT_ID = deploymentId;

let runtime: Awaited<ReturnType<typeof initializeRepositoryRuntime>> | undefined;
let created = false;

try {
  runtime = await initializeRepositoryRuntime();
  if (runtime.driver !== "postgres") throw new Error("PostgreSQL runtime is required");

  const session = record(runId, now);
  await createSession(session);
  created = true;
  await observePublicRuntime(runId, runtimeEvent(session, 1, "active"), now);
  await observePublicRuntime(
    runId,
    runtimeEvent(session, 2, "disconnected"),
    new Date(now.getTime() + 1_000),
  );

  const first = await claimPublicRecoveryOwnership(
    runId,
    { ownerId: "gateway-recovery-owner-a", runtimeSequence: 2 },
    new Date(now.getTime() + 1_001),
  );
  const replay = await claimPublicRecoveryOwnership(
    runId,
    { ownerId: "gateway-recovery-owner-a", runtimeSequence: 2 },
    new Date(now.getTime() + 1_002),
  );
  assertSameOwnership(first, replay);

  let competingRejected = false;
  try {
    await claimPublicRecoveryOwnership(
      runId,
      { ownerId: "gateway-recovery-owner-b", runtimeSequence: 2 },
      new Date(now.getTime() + 1_003),
    );
  } catch (error) {
    competingRejected = code(error) === "public_recovery_owned";
  }
  if (!competingRejected) throw new Error("Competing recovery owner was not rejected");

  await observePublicRuntime(
    runId,
    runtimeEvent(session, 3, "paused"),
    new Date(now.getTime() + 1_004),
  );
  const advanced = await runtime.postgres.sessions.find(runId);
  if (advanced?.publicRecoveryOwnership !== undefined) {
    throw new Error("Runtime advance did not clear recovery ownership");
  }

  if (!await deleteSession(runId)) throw new Error("Test session delete failed");
  const residuals = await cleanup(runId);
  if (Object.values(residuals).some((count) => count !== 0)) {
    throw new Error("Recovery ownership acceptance left residual records");
  }

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    runId,
    database: expectedDatabase,
    firstOwner: first.ownerId,
    sameOwnerSemanticReplay: true,
    competingOwnerRejected: true,
    ownershipClearedOnRuntimeAdvance: true,
    residuals,
  }, null, 2)}\n`);
} finally {
  if (runtime?.driver === "postgres") {
    if (created) await cleanup(runId).catch(() => undefined);
    await runtime.close();
  }
  if (previousDeployment === undefined) delete process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
  else process.env.API_RESULT_SYNC_DEPLOYMENT_ID = previousDeployment;
}

function record(id: string, issuedAt: Date): SessionRecord {
  const expiresAt = new Date(issuedAt.getTime() + 300_000).toISOString();
  return {
    id,
    userId: "recovery-owner-acceptance",
    mode: "conversation",
    status: "active",
    consumedSeconds: 0,
    createdAt: issuedAt.toISOString(),
    lastActivityAt: issuedAt.toISOString(),
    version: 1,
    segments: [],
    processingDeploymentId: deploymentId,
    processingAuthorization: {
      contractVersion: 1,
      processingMode: "online",
      modelPolicyRevision: "recovery-owner-acceptance-v1",
      languagePolicy: { source: "zh", target: "en", autoReverse: false, revision: 1 },
      syncPermission: { allowed: false },
      executionPlan: {
        asr: { execution: "public", scopeKey: "acceptance-asr", reason: "online_selected" },
        translation: { execution: "public", scopeKey: "acceptance-translation", reason: "online_selected" },
        tts: { execution: "disabled" },
      },
    },
    publicRuntimePolicy: {
      leaseId: "acceptance-server-lease",
      captureId: "acceptance-capture",
      languagePolicyKey: "acceptance-language-policy",
      expiresAt,
      maxActiveSeconds: 120,
    },
  };
}

function runtimeEvent(
  session: SessionRecord,
  sequence: number,
  phase: "active" | "paused" | "disconnected",
) {
  const policy = session.publicRuntimePolicy!;
  return {
    leaseId: policy.leaseId,
    captureId: policy.captureId,
    languagePolicyKey: policy.languagePolicyKey,
    sequence,
    phase,
    finalRevision: 0,
    lastAcceptedSample: sequence === 1 ? 0 : 1_600,
  };
}

function assertSameOwnership(
  first: { ownerId: string; runtimeSequence: number; claimedAt: string; expiresAt: string },
  replay: { ownerId: string; runtimeSequence: number; claimedAt: string; expiresAt: string },
) {
  if (first.ownerId !== replay.ownerId ||
    first.runtimeSequence !== replay.runtimeSequence ||
    first.claimedAt !== replay.claimedAt || first.expiresAt !== replay.expiresAt) {
    throw new Error("Same owner recovery claim was not semantically idempotent");
  }
}

async function cleanup(run: string) {
  if (runtime?.driver !== "postgres") return {};
  const pool = runtime.postgres.pool;
  await pool.query("DELETE FROM ai_phone.reliable_outbox_events WHERE session_id = $1", [run]);
  await pool.query("DELETE FROM ai_phone.primary_command_inbox WHERE aggregate_id = $1", [run]);
  await pool.query("DELETE FROM ai_phone.postgres_projection_inbox WHERE namespace = 'sessions' AND record_key = $1", [run]);
  await pool.query("DELETE FROM ai_phone.projection_records WHERE namespace = 'sessions' AND record_key = $1", [run]);
  await pool.query("DELETE FROM ai_phone.communication_sessions WHERE id = $1", [run]);
  await pool.query("DELETE FROM ai_phone.aggregate_writer_leases WHERE aggregate_type = $1 AND aggregate_id = $2", [aggregateType, run]);
  const result = await pool.query<{ table_name: string; count: number }>(`
    SELECT 'aggregate_writer_leases' AS table_name, count(*)::int AS count FROM ai_phone.aggregate_writer_leases WHERE aggregate_id = $1
    UNION ALL SELECT 'primary_command_inbox', count(*)::int FROM ai_phone.primary_command_inbox WHERE aggregate_id = $1
    UNION ALL SELECT 'postgres_projection_inbox', count(*)::int FROM ai_phone.postgres_projection_inbox WHERE namespace = 'sessions' AND record_key = $1
    UNION ALL SELECT 'projection_records', count(*)::int FROM ai_phone.projection_records WHERE namespace = 'sessions' AND record_key = $1
    UNION ALL SELECT 'communication_sessions', count(*)::int FROM ai_phone.communication_sessions WHERE id = $1
    UNION ALL SELECT 'reliable_outbox_events', count(*)::int FROM ai_phone.reliable_outbox_events WHERE session_id = $1
    ORDER BY table_name
  `, [run]);
  return Object.fromEntries(result.rows.map((row) => [row.table_name, row.count]));
}

function code(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code : undefined;
}
