import type { PoolClient } from "pg";

export interface PostgresProjectionApplyEvent {
  id: string;
  namespace: string;
  recordKey: string;
  operation: string;
  payload?: unknown;
}

export async function applyPostgresProjectionEvent(
  client: Pick<PoolClient, "query">,
  event: PostgresProjectionApplyEvent,
) {
  const projectionFunction = event.namespace === "recordingArtifacts"
    ? "ai_phone.apply_recording_artifact_projection_event"
    : event.namespace === "recordingJobs"
    ? "ai_phone.apply_recording_job_projection_event"
    : event.namespace === "agentCallDrafts"
    ? "ai_phone.apply_agent_task_projection_event"
    : event.namespace === "externalMediaSources"
    ? "ai_phone.apply_ingress_projection_event"
    : event.namespace === "agentConsults"
    ? "ai_phone.apply_agent_consult_projection_event"
    : usageProjectionNamespaces.has(event.namespace)
    ? "ai_phone.apply_usage_projection_event"
    : agentProjectionNamespaces.has(event.namespace)
    ? "ai_phone.apply_agent_projection_event"
    : "ai_phone.apply_projection_event";
  const payload = JSON.stringify(event.payload ?? null);
  const application = await client.query<{ applied: boolean }>(
    `SELECT ${projectionFunction}($1, $2, $3, $4, $5::jsonb) AS applied`,
    [event.id, event.namespace, event.recordKey, event.operation, payload],
  );
  if (typeof application.rows[0]?.applied !== "boolean") {
    throw new Error("PostgreSQL projection function returned an invalid result");
  }
  if (application.rows[0]?.applied === false) {
    return { applied: false as const };
  }
  await applyAgentPrimaryAuditColumns(client, event);
  if (event.namespace === "providerOperations" && event.operation === "upsert") {
    await client.query(
      "UPDATE ai_phone.provider_operations SET trace_id = $2 WHERE id = $1",
      [event.recordKey, (event.payload as { traceId?: string } | undefined)?.traceId],
    );
  }
  if (event.namespace === "sessions" && event.operation === "upsert") {
    const session = event.payload as {
      homeRegion?: string;
      homeCellId?: string;
      routingGeneration?: number;
    } | undefined;
    await client.query(`
      UPDATE ai_phone.communication_sessions
      SET home_region = $2, home_cell_id = $3,
          routing_generation = COALESCE($4, routing_generation)
      WHERE id = $1
    `, [
      event.recordKey,
      session?.homeRegion,
      session?.homeCellId,
      session?.routingGeneration,
    ]);
  }
  if (event.operation === "delete") {
    await client.query(
      "DELETE FROM ai_phone.projection_records WHERE namespace = $1 AND record_key = $2",
      [event.namespace, event.recordKey],
    );
    return { applied: true as const };
  }
  const projection = await client.query<{ record_version: string }>(`
    INSERT INTO ai_phone.projection_records(
      namespace, record_key, payload, payload_hash, record_version, updated_at
    ) VALUES ($1, $2, $3::jsonb, md5(($3::jsonb)::text), 1, now())
    ON CONFLICT(namespace, record_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      payload_hash = EXCLUDED.payload_hash,
      record_version = ai_phone.projection_records.record_version + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING record_version
  `, [event.namespace, event.recordKey, payload]);
  const recordVersion = Number(projection.rows[0]?.record_version);
  if (!Number.isSafeInteger(recordVersion) || recordVersion < 1) {
    throw new Error("PostgreSQL projection returned an invalid record version");
  }
  return {
    applied: true as const,
    recordVersion,
  };
}

async function applyAgentPrimaryAuditColumns(
  client: Pick<PoolClient, "query">,
  event: PostgresProjectionApplyEvent,
) {
  if (event.operation !== "upsert" || !agentProjectionNamespaces.has(event.namespace)) {
    return;
  }
  const payload = event.payload as {
    requestHash?: string;
    idempotencyKey?: string;
  } | undefined;
  const table = event.namespace === "agentRuns" ? "agent_runs"
    : event.namespace === "agentSteps" ? "agent_steps"
    : event.namespace === "agentToolExecutions" ? "tool_executions"
    : "handoff_records";
  const idempotencyAssignment = event.namespace === "agentHandoffs"
    ? ", idempotency_key = $3" : "";
  await client.query(`
    UPDATE ai_phone.${table}
    SET request_hash = $2${idempotencyAssignment}
    WHERE id = $1
  `, event.namespace === "agentHandoffs"
    ? [event.recordKey, payload?.requestHash, payload?.idempotencyKey]
    : [event.recordKey, payload?.requestHash]);
}

const agentProjectionNamespaces = new Set([
  "agentRuns",
  "agentSteps",
  "agentToolExecutions",
  "agentHandoffs",
]);

const usageProjectionNamespaces = new Set([
  "usageAccounts",
  "usageHolds",
  "billingLedger",
]);
