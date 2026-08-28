import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Pool } from "pg";
import {
  readVerifiedPostgresCutoverEvidence,
  signPostgresCutoverEvidence,
} from "./postgres-primary-startup.js";
import { expectedPostgresMigrations } from "./postgres-schema-manifest.js";
import {
  validateAgentVoiceDelivery,
  validateVoiceClientOwnership,
} from "./postgres-cutover-voice-validation.js";

interface EvidenceUpgradeValidation {
  migration: string;
  details: Record<string, string | number | boolean>;
}

export async function upgradePostgresCutoverEvidence(
  pool: Pick<Pool, "query">,
) {
  const evidenceFile = process.env.POSTGRES_CUTOVER_EVIDENCE_FILE!.trim();
  const previousRaw = readFileSync(evidenceFile);
  const previous = readVerifiedPostgresCutoverEvidence({
    requireCurrentSchema: false,
  });
  const previousExpected = previous.schema.expected;
  if (JSON.stringify(previousExpected) !== JSON.stringify(previous.schema.applied)) {
    throw new Error("Previous PostgreSQL cutover evidence schema is inconsistent");
  }
  const expected = [...expectedPostgresMigrations];
  if (previousExpected.length >= expected.length ||
    JSON.stringify(expected.slice(0, previousExpected.length)) !==
      JSON.stringify(previousExpected)) {
    throw new Error("Previous PostgreSQL cutover evidence is not a schema prefix");
  }
  const added = expected.slice(previousExpected.length);
  const validations: EvidenceUpgradeValidation[] = [];
  for (const migration of added) {
    const validator = migrationValidators[migration];
    if (!validator) {
      throw new Error(`PostgreSQL evidence upgrade has no validator for ${migration}`);
    }
    validations.push(await validator(pool));
  }
  const schema = await pool.query<{ version: string }>(
    "SELECT version FROM ai_phone.schema_migrations ORDER BY version",
  );
  const applied = schema.rows.map((row) => row.version);
  if (JSON.stringify(applied) !== JSON.stringify(expected)) {
    throw new Error("PostgreSQL schema is not ready for evidence upgrade");
  }
  const identity = await pool.query<{ name: string; oid: string }>(`
    SELECT current_database() AS name,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid
  `);
  if (identity.rows[0]?.name !== previous.database.name ||
    identity.rows[0]?.oid !== previous.database.oid) {
    throw new Error("PostgreSQL evidence upgrade database identity changed");
  }
  const upgradedAt = new Date().toISOString();
  const { signature: _signature, ...unsignedPrevious } = previous;
  const unsigned = {
    ...unsignedPrevious,
    schema: { expected, applied, missing: [], extra: [] },
    auditedAt: upgradedAt,
    evidenceUpgrade: {
      upgradedAt,
      previousEvidenceSha256: createHash("sha256").update(previousRaw).digest("hex"),
      migrations: added,
      validations,
    },
  };
  const upgraded = {
    ...unsigned,
    signature: signPostgresCutoverEvidence(unsigned),
  };
  const temporary = `${evidenceFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(upgraded, null, 2), { mode: 0o600 });
  renameSync(temporary, evidenceFile);
  return {
    status: "upgraded" as const,
    migrations: added,
    validations,
    database: previous.database,
  };
}

const migrationValidators: Record<string, (
  pool: Pick<Pool, "query">,
) => Promise<EvidenceUpgradeValidation>> = {
  "036_air_device_media_policy": validateAirDeviceMediaPolicy,
  "037_agent_voice_work": validateAgentVoiceWork,
  "038_agent_work_permissions": validateAgentWorkPermissions,
  "039_agent_voice_turn_scope": validateAgentVoiceTurnScope,
  "040_voice_client_ownership": validateVoiceClientOwnership,
  "041_agent_voice_delivery": validateAgentVoiceDelivery,
};

async function validateAgentVoiceTurnScope(pool: Pick<Pool, "query">) {
  const objects = await pool.query<{
    scopes_ready: boolean;
    events_ready: boolean;
  }>(`
    SELECT
      to_regclass('ai_phone.agent_voice_turn_scopes') IS NOT NULL
        AS scopes_ready,
      to_regclass('ai_phone.agent_voice_turn_events') IS NOT NULL
        AS events_ready
  `);
  const invalid = await pool.query<{
    invalid_active: string;
    latest_event_mismatch: string;
  }>(`
    SELECT
      (SELECT count(*) FROM ai_phone.agent_voice_turn_scopes
        WHERE state = 'active'
          AND explicit_instruction_evidence_hash IS NULL
      )::text AS invalid_active,
      (SELECT count(*) FROM ai_phone.agent_voice_turn_scopes AS scope
        LEFT JOIN LATERAL (
          SELECT event.result_turn_id, event.result_turn_generation,
            event.result_state,
            event.result_explicit_instruction_evidence_hash,
            event.dispatch_generation
          FROM ai_phone.agent_voice_turn_events AS event
          WHERE event.session_id = scope.session_id
            AND event.leg_id = scope.leg_id
          ORDER BY event.result_turn_generation DESC, event.event_id DESC
          LIMIT 1
        ) AS latest ON true
        WHERE latest.result_turn_id IS NULL
          OR latest.result_turn_id <> scope.current_turn_id
          OR latest.result_turn_generation <> scope.turn_generation
          OR latest.result_state <> scope.state
          OR latest.result_explicit_instruction_evidence_hash
            IS DISTINCT FROM scope.explicit_instruction_evidence_hash
          OR latest.dispatch_generation <> scope.dispatch_generation
      )::text AS latest_event_mismatch
  `);
  const scopesReady = objects.rows[0]?.scopes_ready === true;
  const eventsReady = objects.rows[0]?.events_ready === true;
  const invalidActive = Number(invalid.rows[0]?.invalid_active ?? -1);
  const latestEventMismatch = Number(
    invalid.rows[0]?.latest_event_mismatch ?? -1,
  );
  if (!scopesReady || !eventsReady || invalidActive !== 0 ||
    latestEventMismatch !== 0) {
    throw new Error("PostgreSQL Agent voice turn scope validation failed");
  }
  return {
    migration: "039_agent_voice_turn_scope",
    details: {
      scopesReady,
      eventsReady,
      invalidActive,
      latestEventMismatch,
    },
  };
}

async function validateAgentWorkPermissions(pool: Pick<Pool, "query">) {
  const objects = await pool.query<{
    requests_ready: boolean;
    authorizations_ready: boolean;
    work_fk_validated: boolean;
  }>(`
    SELECT
      to_regclass('ai_phone.agent_permission_requests') IS NOT NULL
        AS requests_ready,
      to_regclass('ai_phone.agent_turn_authorizations') IS NOT NULL
        AS authorizations_ready,
      EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_works_authorization_snapshot_fk'
          AND conrelid = 'ai_phone.agent_works'::regclass
          AND convalidated
      ) AS work_fk_validated
  `);
  const invalid = await pool.query<{
    invalid_grants: string;
    invalid_active: string;
  }>(`
    SELECT
      (SELECT count(*) FROM ai_phone.agent_permission_requests
        WHERE status = 'granted' AND (
          authorization_snapshot_id IS NULL OR authorizer_evidence_hash IS NULL
        ))::text AS invalid_grants,
      (SELECT count(*) FROM ai_phone.agent_turn_authorizations AS auth_snapshot
        LEFT JOIN ai_phone.agent_permission_requests AS request
          ON request.permission_request_id = auth_snapshot.permission_request_id
        WHERE auth_snapshot.status = 'active' AND (
          request.status <> 'granted'
          OR request.authorization_snapshot_id <>
            auth_snapshot.authorization_snapshot_id
        ))::text AS invalid_active
  `);
  const invalidGrants = Number(invalid.rows[0]?.invalid_grants ?? -1);
  const invalidActive = Number(invalid.rows[0]?.invalid_active ?? -1);
  const requestsReady = objects.rows[0]?.requests_ready === true;
  const authorizationsReady = objects.rows[0]?.authorizations_ready === true;
  const workFkValidated = objects.rows[0]?.work_fk_validated === true;
  if (!requestsReady || !authorizationsReady || !workFkValidated ||
    invalidGrants !== 0 || invalidActive !== 0) {
    throw new Error("PostgreSQL Agent Work permission validation failed");
  }
  return {
    migration: "038_agent_work_permissions",
    details: {
      invalidGrants,
      invalidActive,
      requestsReady,
      authorizationsReady,
      workFkValidated,
    },
  };
}

async function validateAgentVoiceWork(pool: Pick<Pool, "query">) {
  const objects = await pool.query<{
    table_ready: boolean;
    claim_function_ready: boolean;
  }>(`
    SELECT
      to_regclass('ai_phone.agent_works') IS NOT NULL AS table_ready,
      to_regprocedure(
        'ai_phone.claim_agent_works(text,text,integer,integer,integer,timestamptz)'
      ) IS NOT NULL AS claim_function_ready
  `);
  const rows = await pool.query<{
    total: string;
    invalid_status: string;
    invalid_claim: string;
  }>(`
    SELECT count(*)::text AS total,
      count(*) FILTER (WHERE status NOT IN (
        'queued', 'running', 'delegated', 'finalizing', 'cancelling',
        'completed', 'cancelled', 'failed'
      ))::text AS invalid_status,
      count(*) FILTER (WHERE
        (claim_id IS NULL) <> (claim_owner IS NULL)
        OR (claim_id IS NULL) <> (claim_expires_at IS NULL)
      )::text AS invalid_claim
    FROM ai_phone.agent_works
  `);
  const total = Number(rows.rows[0]?.total ?? -1);
  const invalidStatus = Number(rows.rows[0]?.invalid_status ?? -1);
  const invalidClaim = Number(rows.rows[0]?.invalid_claim ?? -1);
  const tableReady = objects.rows[0]?.table_ready === true;
  const claimFunctionReady = objects.rows[0]?.claim_function_ready === true;
  if (!tableReady || !claimFunctionReady || !Number.isSafeInteger(total) ||
    total < 0 || invalidStatus !== 0 || invalidClaim !== 0) {
    throw new Error("PostgreSQL Agent Voice Work validation failed");
  }
  return {
    migration: "037_agent_voice_work",
    details: {
      total,
      invalidStatus,
      invalidClaim,
      tableReady,
      claimFunctionReady,
    },
  };
}

async function validateAirDeviceMediaPolicy(pool: Pick<Pool, "query">) {
  const rows = await pool.query<{
    total: string;
    missing: string;
    unsupported: string;
  }>(`
    SELECT count(*)::text AS total,
      count(*) FILTER (WHERE media_policy IS NULL)::text AS missing,
      count(*) FILTER (
        WHERE media_policy NOT IN ('translation_isolated', 'agent_monitored')
      )::text AS unsupported
    FROM ai_phone.air_device_calls
  `);
  const constraint = await pool.query<{ validated: boolean }>(`
    SELECT convalidated AS validated
    FROM pg_constraint
    WHERE conname = 'air_device_calls_media_policy_check'
      AND conrelid = 'ai_phone.air_device_calls'::regclass
  `);
  const total = Number(rows.rows[0]?.total ?? -1);
  const missing = Number(rows.rows[0]?.missing ?? -1);
  const unsupported = Number(rows.rows[0]?.unsupported ?? -1);
  const constraintValidated = constraint.rows[0]?.validated === true;
  if (!Number.isSafeInteger(total) || total < 0 || missing !== 0 ||
    unsupported !== 0 || !constraintValidated) {
    throw new Error("PostgreSQL Air device media policy validation failed");
  }
  return {
    migration: "036_air_device_media_policy",
    details: { total, missing, unsupported, constraintValidated },
  };
}
