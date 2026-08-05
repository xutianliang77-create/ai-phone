import type { Pool, QueryResultRow } from "pg";
import type { AirDeviceCallDto } from "@translation/contracts";

export class DeviceCallBindingConflict extends Error {
  constructor() {
    super("Stale Air device call binding");
    this.name = "DeviceCallBindingConflict";
  }
}

interface AirDeviceCallRecordInput {
  providerCallId: string;
  providerOperationId: string;
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  roomName: string;
  participantIdentity: string;
  callGeneration: number;
}

export class PostgresAirDeviceCallsRepository {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async recordDial(input: AirDeviceCallRecordInput) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<AirDeviceCallRow>(`
        WITH inserted AS (
          INSERT INTO ai_phone.air_device_calls(
            provider_call_id, communication_session_id, provider_operation_id,
            device_id, lease_id, fencing_token, room_name,
            participant_identity, carrier_state,
            livekit_participant_state, call_generation
          )
          SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'dialing', 'absent', $9
          FROM ai_phone.provider_operations AS provider
          JOIN ai_phone.air_device_leases AS lease
            ON lease.lease_id = $5 AND lease.device_id = $4
            AND lease.fencing_token = $6 AND lease.status = 'active'
            AND lease.expires_at > now()
          WHERE provider.id = $3 AND provider.session_id = $2
            AND provider.provider = 'air780_volte'
            AND provider.operation_type = 'phone_outbound'
            AND provider.status IN ('in_flight', 'accepted', 'unknown', 'active')
          ON CONFLICT(provider_operation_id) DO NOTHING
          RETURNING *
        )
        , saved AS (
          SELECT * FROM inserted
          UNION ALL
          SELECT * FROM ai_phone.air_device_calls
          WHERE provider_operation_id = $3 AND NOT EXISTS(SELECT 1 FROM inserted)
          LIMIT 1
        ), outboxed AS (
          INSERT INTO ai_phone.reliable_outbox_events(
            id, idempotency_key, session_id, aggregate_version, sequence,
            event_type, event_version, payload
          )
          SELECT 'air-call-dialed-' || provider_operation_id,
            'air-call-dialed-' || provider_operation_id,
            communication_session_id, version, version,
            'device.call.dialing', 1,
            jsonb_build_object(
              'providerCallId', provider_call_id,
              'deviceId', device_id,
              'leaseId', lease_id,
              'fencingToken', fencing_token,
              'callGeneration', call_generation
            )
          FROM saved WHERE true
          ON CONFLICT(idempotency_key) DO NOTHING RETURNING id
        )
        SELECT * FROM saved
      `, [input.providerCallId, input.communicationSessionId,
        input.providerOperationId, input.deviceId, input.leaseId,
        input.fencingToken, input.roomName, input.participantIdentity,
        input.callGeneration]);
      const row = result.rows[0];
      if (!row || !matchesDial(row, input)) throw new DeviceCallBindingConflict();
      return airDeviceCallFromRow(row);
    } finally {
      client.release();
    }
  }

  async recordDialRejected(input: AirDeviceCallRecordInput) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<AirDeviceCallRow>(`
        WITH updated AS (
          UPDATE ai_phone.air_device_calls
          SET carrier_state = 'failed', ended_at = COALESCE(ended_at, now()),
            version = version + 1, updated_at = now()
          WHERE provider_call_id = $1 AND communication_session_id = $2
            AND provider_operation_id = $3 AND device_id = $4
            AND lease_id = $5 AND fencing_token = $6
            AND room_name = $7 AND participant_identity = $8
            AND call_generation = $9 AND carrier_state = 'dialing'
          RETURNING *
        ), saved AS (
          SELECT * FROM updated
          UNION ALL
          SELECT * FROM ai_phone.air_device_calls
          WHERE provider_call_id = $1 AND communication_session_id = $2
            AND provider_operation_id = $3 AND device_id = $4
            AND lease_id = $5 AND fencing_token = $6
            AND room_name = $7 AND participant_identity = $8
            AND call_generation = $9 AND carrier_state = 'failed'
            AND NOT EXISTS(SELECT 1 FROM updated)
          LIMIT 1
        ), outboxed AS (
          INSERT INTO ai_phone.reliable_outbox_events(
            id, idempotency_key, session_id, aggregate_version, sequence,
            event_type, event_version, payload
          )
          SELECT 'air-call-dial-rejected-' || provider_operation_id,
            'air-call-dial-rejected-' || provider_operation_id,
            communication_session_id, version, version,
            'device.call.failed', 1,
            jsonb_build_object(
              'providerCallId', provider_call_id,
              'deviceId', device_id,
              'leaseId', lease_id,
              'fencingToken', fencing_token,
              'callGeneration', call_generation,
              'reason', 'command_rejected'
            )
          FROM saved WHERE true
          ON CONFLICT(idempotency_key) DO NOTHING RETURNING id
        )
        SELECT * FROM saved
      `, [input.providerCallId, input.communicationSessionId,
        input.providerOperationId, input.deviceId, input.leaseId,
        input.fencingToken, input.roomName, input.participantIdentity,
        input.callGeneration]);
      const row = result.rows[0];
      if (!row || row.carrier_state !== "failed" || !matchesDial(row, input)) {
        throw new DeviceCallBindingConflict();
      }
      return airDeviceCallFromRow(row);
    } finally {
      client.release();
    }
  }

  async assertCallBinding(input: {
    communicationSessionId: string;
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    callGeneration: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<CurrentRow>(`
        SELECT EXISTS(
          SELECT 1 FROM ai_phone.air_device_calls
          WHERE communication_session_id = $1 AND device_id = $2
            AND lease_id = $3 AND fencing_token = $4
            AND call_generation = $5
            AND carrier_state IN ('dialing', 'ringing', 'connected', 'unknown')
        ) AS current
      `, [input.communicationSessionId, input.deviceId, input.leaseId,
        input.fencingToken, input.callGeneration]);
      if (result.rows[0]?.current !== true) throw new DeviceCallBindingConflict();
    } finally {
      client.release();
    }
  }

  async findActiveBinding(input: {
    communicationSessionId: string;
    providerOperationId: string;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<AirDeviceCallRow>(`
        SELECT * FROM ai_phone.air_device_calls
        WHERE communication_session_id = $1 AND provider_operation_id = $2
          AND carrier_state IN ('dialing', 'ringing', 'connected', 'unknown')
          AND ai_phone.air_device_lease_is_current(
            device_id, lease_id, fencing_token
          )
        LIMIT 1
      `, [input.communicationSessionId, input.providerOperationId]);
      const row = result.rows[0];
      return row ? airDeviceControlBindingFromRow(row) : null;
    } finally {
      client.release();
    }
  }

  async findCallStatus(input: {
    communicationSessionId: string;
    providerOperationId: string;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<AirDeviceCallRow>(`
        SELECT * FROM ai_phone.air_device_calls
        WHERE communication_session_id = $1 AND provider_operation_id = $2
        LIMIT 1
      `, [input.communicationSessionId, input.providerOperationId]);
      const row = result.rows[0];
      return row ? airDeviceCallFromRow(row) : null;
    } finally {
      client.release();
    }
  }

  async listReconcile(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid Air device reconciliation limit");
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query<AirDeviceCallRow>(`
        SELECT provider_call_id, communication_session_id,
          provider_operation_id, device_id, lease_id, fencing_token,
          carrier_state, livekit_participant_state, call_generation, version
        FROM ai_phone.air_device_calls
        WHERE carrier_state IN ('dialing', 'ringing', 'connected', 'unknown')
        ORDER BY updated_at, provider_call_id LIMIT $1
      `, [limit]);
      return result.rows.map(airDeviceCallFromRow);
    } finally {
      client.release();
    }
  }
}

interface CurrentRow extends QueryResultRow {
  current: boolean;
}

export interface AirDeviceCallRow extends QueryResultRow {
  provider_call_id: string;
  communication_session_id: string;
  provider_operation_id: string;
  device_id: string;
  lease_id: string;
  fencing_token: string;
  carrier_state: AirDeviceCallDto["carrierState"];
  livekit_participant_state: AirDeviceCallDto["liveKitParticipantState"];
  call_generation: string;
  version: string;
  room_name: string;
  participant_identity: string;
  carrier_event_sequence: string;
  livekit_event_sequence: string;
  connected_at?: Date | string | null;
  ended_at?: Date | string | null;
}

function matchesDial(row: AirDeviceCallRow, input: AirDeviceCallRecordInput) {
  return row.provider_call_id === input.providerCallId &&
    row.provider_operation_id === input.providerOperationId &&
    row.communication_session_id === input.communicationSessionId &&
    row.device_id === input.deviceId && row.lease_id === input.leaseId &&
    Number(row.fencing_token) === input.fencingToken &&
    row.room_name === input.roomName &&
    row.participant_identity === input.participantIdentity &&
    Number(row.call_generation) === input.callGeneration;
}

export function airDeviceCallFromRow(row: AirDeviceCallRow): AirDeviceCallDto {
  const fencingToken = Number(row.fencing_token);
  const callGeneration = Number(row.call_generation);
  const version = Number(row.version);
  if (!row.provider_call_id || !row.communication_session_id ||
    !row.provider_operation_id || !row.device_id || !row.lease_id ||
    !Number.isSafeInteger(fencingToken) || fencingToken < 1 ||
    !Number.isSafeInteger(callGeneration) || callGeneration < 0 ||
    !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Invalid PostgreSQL Air device call");
  }
  const connectedAt = timestamp(row.connected_at);
  const endedAt = timestamp(row.ended_at);
  return {
    providerCallId: row.provider_call_id,
    communicationSessionId: row.communication_session_id,
    providerOperationId: row.provider_operation_id,
    deviceId: row.device_id,
    leaseId: row.lease_id,
    fencingToken,
    carrierState: row.carrier_state,
    liveKitParticipantState: row.livekit_participant_state,
    callGeneration,
    version,
    ...(connectedAt ? { connectedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
  };
}

function timestamp(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function airDeviceControlBindingFromRow(row: AirDeviceCallRow) {
  const call = airDeviceCallFromRow(row);
  if (!row.room_name || !row.participant_identity) {
    throw new Error("Invalid PostgreSQL Air device control binding");
  }
  return {
    providerCallId: call.providerCallId,
    participantIdentity: row.participant_identity,
    roomName: row.room_name,
    carrierState: call.carrierState,
    callGeneration: call.callGeneration,
    deviceLease: {
      deviceId: call.deviceId,
      leaseId: call.leaseId,
      fencingToken: call.fencingToken,
    },
  };
}
