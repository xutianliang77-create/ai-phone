import type { Pool } from "pg";

export async function validateVoiceClientOwnership(
  pool: Pick<Pool, "query">,
) {
  const objects = await pool.query<{
    ownerships_ready: boolean;
    takeovers_ready: boolean;
    active_index_ready: boolean;
    pending_index_ready: boolean;
    constraints_validated: boolean;
  }>(`
    SELECT
      to_regclass('ai_phone.voice_client_ownerships') IS NOT NULL
        AS ownerships_ready,
      to_regclass('ai_phone.voice_client_takeovers') IS NOT NULL
        AS takeovers_ready,
      to_regclass('ai_phone.voice_client_ownership_active_idx') IS NOT NULL
        AS active_index_ready,
      to_regclass('ai_phone.voice_client_takeover_pending_idx') IS NOT NULL
        AS pending_index_ready,
      NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid IN (
          to_regclass('ai_phone.voice_client_ownerships'),
          to_regclass('ai_phone.voice_client_takeovers')
        ) AND NOT convalidated
      ) AS constraints_validated
  `);
  const invalid = await pool.query<{
    invalid_ownerships: string;
    invalid_takeovers: string;
    orphan_takeovers: string;
  }>(`
    SELECT
      (SELECT count(*) FROM ai_phone.voice_client_ownerships
        WHERE lease_expires_at <= created_at OR
          (state = 'active' AND
            (released_at IS NOT NULL OR release_reason IS NOT NULL)) OR
          (state = 'released' AND
            (released_at IS NULL OR release_reason IS NULL))
      )::text AS invalid_ownerships,
      (SELECT count(*) FROM ai_phone.voice_client_takeovers
        WHERE expires_at <= created_at OR
          ((status = 'confirmed') <> (confirmed_at IS NOT NULL))
      )::text AS invalid_takeovers,
      (SELECT count(*) FROM ai_phone.voice_client_takeovers AS takeover
        LEFT JOIN ai_phone.voice_client_ownerships AS ownership
          ON ownership.session_id = takeover.session_id
          AND ownership.leg_id = takeover.leg_id
        WHERE ownership.session_id IS NULL
      )::text AS orphan_takeovers
  `);
  const state = objects.rows[0];
  const invalidOwnerships = count(invalid.rows[0]?.invalid_ownerships);
  const invalidTakeovers = count(invalid.rows[0]?.invalid_takeovers);
  const orphanTakeovers = count(invalid.rows[0]?.orphan_takeovers);
  if (!state?.ownerships_ready || !state.takeovers_ready ||
    !state.active_index_ready || !state.pending_index_ready ||
    !state.constraints_validated || invalidOwnerships !== 0 ||
    invalidTakeovers !== 0 || orphanTakeovers !== 0) {
    throw new Error("PostgreSQL voice client ownership validation failed");
  }
  return {
    migration: "040_voice_client_ownership",
    details: {
      ownershipsReady: true,
      takeoversReady: true,
      activeIndexReady: true,
      pendingIndexReady: true,
      constraintsValidated: true,
      invalidOwnerships,
      invalidTakeovers,
      orphanTakeovers,
    },
  };
}

export async function validateAgentVoiceDelivery(
  pool: Pick<Pool, "query">,
) {
  const objects = await pool.query<{
    attempts_ready: boolean;
    receipts_ready: boolean;
    client_events_ready: boolean;
    claim_function_ready: boolean;
    active_index_ready: boolean;
    constraints_validated: boolean;
  }>(`
    SELECT
      to_regclass('ai_phone.agent_delivery_attempts') IS NOT NULL
        AS attempts_ready,
      to_regclass('ai_phone.agent_delivery_receipts') IS NOT NULL
        AS receipts_ready,
      to_regclass('ai_phone.agent_delivery_client_events') IS NOT NULL
        AS client_events_ready,
      to_regprocedure(
        'ai_phone.claim_agent_deliveries(text,text,integer,integer,integer,timestamptz)'
      ) IS NOT NULL AS claim_function_ready,
      to_regclass('ai_phone.agent_delivery_one_active_work_idx') IS NOT NULL
        AS active_index_ready,
      NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid IN (
          to_regclass('ai_phone.agent_delivery_attempts'),
          to_regclass('ai_phone.agent_delivery_receipts'),
          to_regclass('ai_phone.agent_delivery_client_events')
        ) AND NOT convalidated
      ) AS constraints_validated
  `);
  const invalid = await pool.query<{
    invalid_attempts: string;
    invalid_client_events: string;
    orphan_receipts: string;
    orphan_client_events: string;
    incomplete_playback: string;
  }>(`
    SELECT
      (SELECT count(*) FROM ai_phone.agent_delivery_attempts
        WHERE expires_at <= created_at OR
          (claim_id IS NULL) <> (claim_owner IS NULL) OR
          (claim_id IS NULL) <> (claim_expires_at IS NULL) OR
          (playback_id IS NULL) <> (playback_generation IS NULL) OR
          (playback_id IS NULL) <> (worker_participant_identity IS NULL) OR
          ((status IN ('playback_ended', 'cancelled', 'failed', 'expired')) <>
            (ended_at IS NOT NULL)) OR
          (status IN ('generated', 'claimed') AND playback_id IS NOT NULL) OR
          (status IN ('queued_for_playback', 'playback_started',
            'playback_ended') AND playback_id IS NULL)
      )::text AS invalid_attempts,
      (SELECT count(*) FROM ai_phone.agent_delivery_client_events
        WHERE expires_at <= created_at OR
          (claim_id IS NULL) <> (claim_owner IS NULL) OR
          (claim_id IS NULL) <> (claim_expires_at IS NULL) OR
          ((status = 'published') <> (published_at IS NOT NULL))
      )::text AS invalid_client_events,
      (SELECT count(*) FROM ai_phone.agent_delivery_receipts AS receipt
        LEFT JOIN ai_phone.agent_delivery_attempts AS attempt
          ON attempt.delivery_attempt_id = receipt.delivery_attempt_id
        WHERE attempt.delivery_attempt_id IS NULL
      )::text AS orphan_receipts,
      (SELECT count(*) FROM ai_phone.agent_delivery_client_events AS event
        LEFT JOIN ai_phone.agent_delivery_attempts AS attempt
          ON attempt.delivery_attempt_id = event.delivery_attempt_id
        WHERE attempt.delivery_attempt_id IS NULL
      )::text AS orphan_client_events,
      (SELECT count(*) FROM ai_phone.agent_delivery_attempts AS attempt
        WHERE attempt.status = 'playback_ended' AND NOT EXISTS (
          SELECT 1 FROM ai_phone.agent_delivery_receipts AS receipt
          WHERE receipt.delivery_attempt_id = attempt.delivery_attempt_id
            AND receipt.receipt_type = 'client.playback.ended'
        )
      )::text AS incomplete_playback
  `);
  const state = objects.rows[0];
  const invalidAttempts = count(invalid.rows[0]?.invalid_attempts);
  const invalidClientEvents = count(invalid.rows[0]?.invalid_client_events);
  const orphanReceipts = count(invalid.rows[0]?.orphan_receipts);
  const orphanClientEvents = count(invalid.rows[0]?.orphan_client_events);
  const incompletePlayback = count(invalid.rows[0]?.incomplete_playback);
  if (!state?.attempts_ready || !state.receipts_ready ||
    !state.client_events_ready || !state.claim_function_ready ||
    !state.active_index_ready || !state.constraints_validated ||
    invalidAttempts !== 0 || invalidClientEvents !== 0 ||
    orphanReceipts !== 0 || orphanClientEvents !== 0 ||
    incompletePlayback !== 0) {
    throw new Error("PostgreSQL Agent voice delivery validation failed");
  }
  return {
    migration: "041_agent_voice_delivery",
    details: {
      attemptsReady: true,
      receiptsReady: true,
      clientEventsReady: true,
      claimFunctionReady: true,
      activeIndexReady: true,
      constraintsValidated: true,
      invalidAttempts,
      invalidClientEvents,
      orphanReceipts,
      orphanClientEvents,
      incompletePlayback,
    },
  };
}

function count(value: unknown) {
  const parsed = Number(value ?? -1);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}
