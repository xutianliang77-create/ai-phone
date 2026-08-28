import type { Pool, PoolClient } from "pg";
import {
  parseAgentDeliveryLifecycleEvent,
  type AgentDeliveryLifecycleEvent,
} from "@translation/contracts";
import { repositoryRequestHash } from
  "../../infrastructure/storage/repository-command-identity.js";
import {
  AgentWorkPostgresSupport,
  boundedWorkInteger,
  boundedWorkValue,
  lockWork,
  validWorkDate,
} from "./postgres-agent-work-support.js";
import { AgentDeliveryRecordError } from "./agent-delivery-record.js";

interface ClientEventRow extends Record<string, unknown> {
  event_id: string;
  delivery_attempt_id: string;
  event_type: string;
  event_hash: string;
  payload: unknown;
  status: string;
  available_at: unknown;
  expires_at: unknown;
  claim_id: string | null;
  claim_owner: string | null;
  claim_expires_at: unknown;
  publish_attempt: unknown;
}

export interface AgentDeliveryClientEventClaim {
  event: AgentDeliveryLifecycleEvent;
  claimId: string;
  claimOwner: string;
  claimExpiresAt: string;
  publishAttempt: number;
}

export class PostgresAgentDeliveryClientEventsRepository {
  private readonly support: AgentWorkPostgresSupport;

  constructor(pool: Pick<Pool, "connect">) {
    this.support = new AgentWorkPostgresSupport(pool);
  }

  async claim(input: {
    owner: string;
    limit?: number;
    leaseSeconds?: number;
    now?: Date;
  }) {
    const owner = boundedWorkValue(input.owner, "delivery_event_owner", 200, 8);
    const limit = boundedWorkInteger(
      input.limit ?? 25,
      "delivery_event_limit",
      1,
      50,
    );
    const leaseSeconds = boundedWorkInteger(
      input.leaseSeconds ?? 30,
      "delivery_event_lease",
      5,
      120,
    );
    const now = validWorkDate(input.now ?? new Date(), "delivery_event_now");
    return this.support.transaction(async (client) => {
      await lockWork(client, `agent-delivery-client-events:${owner}`);
      const result = await client.query<ClientEventRow>(`
        WITH candidates AS (
          SELECT candidate.event_id
          FROM ai_phone.agent_delivery_client_events AS candidate
          WHERE candidate.status = 'pending'
            AND candidate.available_at <= $1::timestamptz
            AND candidate.expires_at > $1::timestamptz
            AND (candidate.claim_id IS NULL
              OR candidate.claim_expires_at <= $1::timestamptz)
            AND NOT EXISTS (
              SELECT 1
              FROM ai_phone.agent_delivery_client_events AS earlier
              WHERE earlier.delivery_attempt_id = candidate.delivery_attempt_id
                AND earlier.status <> 'published'
                AND (earlier.created_at, earlier.event_id)
                  < (candidate.created_at, candidate.event_id)
            )
          ORDER BY candidate.created_at, candidate.event_id
          FOR UPDATE SKIP LOCKED LIMIT $2
        )
        UPDATE ai_phone.agent_delivery_client_events AS event
        SET claim_id = event.event_id || ':' || (event.publish_attempt + 1)::text,
          claim_owner = $3,
          claim_expires_at = LEAST(
            event.expires_at,
            $1::timestamptz + make_interval(secs => $4)
          ),
          publish_attempt = event.publish_attempt + 1,
          updated_at = $1::timestamptz
        FROM candidates
        WHERE event.event_id = candidates.event_id
        RETURNING event.*
      `, [now.toISOString(), limit, owner, leaseSeconds]);
      return result.rows.map(clientEventClaimFromRow);
    });
  }

  async markPublished(input: {
    eventId: string;
    claimId: string;
    owner: string;
    now?: Date;
  }) {
    return this.finishClaim(input, "published");
  }

  async releaseForRetry(input: {
    eventId: string;
    claimId: string;
    owner: string;
    now?: Date;
  }) {
    const eventId = boundedWorkValue(input.eventId, "delivery_event_id", 200);
    const claimId = boundedWorkValue(input.claimId, "delivery_event_claim", 240);
    const owner = boundedWorkValue(input.owner, "delivery_event_owner", 200, 8);
    const now = validWorkDate(input.now ?? new Date(), "delivery_event_now");
    return this.support.transaction(async (client) => {
      const current = await requireClientEvent(client, eventId, true);
      assertClaim(current, claimId, owner, now);
      const expired = Date.parse(String(current.expires_at)) <= now.getTime();
      const result = await client.query<ClientEventRow>(`
        UPDATE ai_phone.agent_delivery_client_events
        SET status = CASE WHEN $2 THEN 'expired' ELSE 'pending' END,
          available_at = CASE WHEN $2 THEN available_at ELSE
            $3::timestamptz + make_interval(secs => LEAST(
              30, (2 ^ LEAST(publish_attempt, 5))::integer
            )) END,
          claim_id = NULL, claim_owner = NULL, claim_expires_at = NULL,
          updated_at = $3::timestamptz
        WHERE event_id = $1 RETURNING *
      `, [eventId, expired, now.toISOString()]);
      assertClientEventIntegrity(result.rows[0]!);
    });
  }

  async expire(now = new Date()) {
    const checked = validWorkDate(now, "delivery_event_expire_now");
    return this.support.transaction(async (client) => {
      const result = await client.query<{ event_id: string }>(`
        UPDATE ai_phone.agent_delivery_client_events
        SET status = 'expired', claim_id = NULL, claim_owner = NULL,
          claim_expires_at = NULL, updated_at = $1::timestamptz
        WHERE status = 'pending' AND expires_at <= $1::timestamptz
        RETURNING event_id
      `, [checked.toISOString()]);
      return result.rows.length;
    });
  }

  private async finishClaim(input: {
    eventId: string;
    claimId: string;
    owner: string;
    now?: Date;
  }, status: "published") {
    const eventId = boundedWorkValue(input.eventId, "delivery_event_id", 200);
    const claimId = boundedWorkValue(input.claimId, "delivery_event_claim", 240);
    const owner = boundedWorkValue(input.owner, "delivery_event_owner", 200, 8);
    const now = validWorkDate(input.now ?? new Date(), "delivery_event_now");
    return this.support.transaction(async (client) => {
      const current = await requireClientEvent(client, eventId, true);
      if (current.status === status) return { replayed: true };
      assertClaim(current, claimId, owner, now);
      await client.query(`
        UPDATE ai_phone.agent_delivery_client_events
        SET status = $2, published_at = $3::timestamptz,
          claim_id = NULL, claim_owner = NULL, claim_expires_at = NULL,
          updated_at = $3::timestamptz
        WHERE event_id = $1
      `, [eventId, status, now.toISOString()]);
      return { replayed: false };
    });
  }
}

export async function enqueueAgentDeliveryClientEvent(
  client: Pick<PoolClient, "query">,
  event: AgentDeliveryLifecycleEvent,
  now: Date,
) {
  const eventHash = repositoryRequestHash(event);
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const result = await client.query<ClientEventRow>(`
    INSERT INTO ai_phone.agent_delivery_client_events AS event_row(
      event_id, delivery_attempt_id, event_type, event_hash, payload,
      status, available_at, expires_at, publish_attempt, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6::timestamptz,
      $7::timestamptz, 0, $6::timestamptz, $6::timestamptz)
    ON CONFLICT(event_id) DO UPDATE SET event_id = EXCLUDED.event_id
    WHERE event_row.event_hash = EXCLUDED.event_hash
    RETURNING event_row.*
  `, [event.eventId, event.deliveryAttemptId, event.type, eventHash,
    JSON.stringify(event), now.toISOString(), expiresAt.toISOString()]);
  if (!result.rows[0]) {
    throw new AgentDeliveryRecordError(
      "delivery_client_event_identity_conflict",
    );
  }
  assertClientEventIntegrity(result.rows[0]);
}

function clientEventClaimFromRow(
  row: ClientEventRow,
): AgentDeliveryClientEventClaim {
  const event = assertClientEventIntegrity(row);
  const claimId = row.claim_id;
  const claimOwner = row.claim_owner;
  const claimExpiresAt = row.claim_expires_at;
  if (!claimId || !claimOwner || !claimExpiresAt) {
    throw new AgentDeliveryRecordError("delivery_client_event_claim_missing");
  }
  const publishAttempt = Number(row.publish_attempt);
  if (!Number.isSafeInteger(publishAttempt) || publishAttempt < 1) {
    throw new AgentDeliveryRecordError("delivery_client_event_corrupt");
  }
  return {
    event,
    claimId,
    claimOwner,
    claimExpiresAt: new Date(String(claimExpiresAt)).toISOString(),
    publishAttempt,
  };
}

function assertClientEventIntegrity(row: ClientEventRow) {
  const event = parseAgentDeliveryLifecycleEvent(row.payload);
  if (repositoryRequestHash(event) !== row.event_hash ||
      event.eventId !== row.event_id ||
      event.deliveryAttemptId !== row.delivery_attempt_id ||
      event.type !== row.event_type) {
    throw new AgentDeliveryRecordError("delivery_client_event_corrupt");
  }
  return event;
}

async function requireClientEvent(
  client: Pick<PoolClient, "query">,
  eventId: string,
  forUpdate = false,
) {
  const result = await client.query(`
    SELECT * FROM ai_phone.agent_delivery_client_events
    WHERE event_id = $1 ${forUpdate ? "FOR UPDATE" : ""}
  `, [eventId]) as { rows: ClientEventRow[] };
  if (!result.rows[0]) {
    throw new AgentDeliveryRecordError("delivery_client_event_not_found");
  }
  return result.rows[0];
}

function assertClaim(
  row: ClientEventRow,
  claimId: string,
  owner: string,
  now: Date,
) {
  if (row.status !== "pending" || row.claim_id !== claimId ||
      row.claim_owner !== owner || !row.claim_expires_at ||
      Date.parse(String(row.claim_expires_at)) <= now.getTime()) {
    throw new AgentDeliveryRecordError("delivery_client_event_claim_stale");
  }
}
