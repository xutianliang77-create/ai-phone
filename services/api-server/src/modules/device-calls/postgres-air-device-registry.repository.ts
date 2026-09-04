import type { Pool, PoolClient } from "pg";
import type {
  AirDeviceHeartbeatRequest,
  AirDeviceRegistrationDto,
} from "@translation/contracts";
import { DeviceLeaseConflict } from "./device-lease-registry.js";
import {
  type CurrentRow,
  type DeviceRow,
  fromDeviceRow,
  fromLeaseRow,
  type LeaseRow,
  type PostgresAirDeviceLease,
  type ReleasedRow,
} from "./postgres-air-device-registry-mappers.js";

export type { PostgresAirDeviceLease } from
  "./postgres-air-device-registry-mappers.js";

export class PostgresAirDeviceRegistryRepository {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async register(input: {
    deviceId: string;
    firmwareVersion: string;
    protocolVersion: string;
    supportedSampleRates: Array<8_000 | 16_000>;
    observedAt: Date;
  }): Promise<AirDeviceRegistrationDto> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<DeviceRow>(`
        INSERT INTO ai_phone.air_devices AS device(
          device_id, firmware_version, protocol_version,
          supported_sample_rates, status, last_heartbeat_at
        ) VALUES ($1, $2, $3, $4, 'ready', $5)
        ON CONFLICT(device_id) DO UPDATE SET
          firmware_version = EXCLUDED.firmware_version,
          protocol_version = EXCLUDED.protocol_version,
          supported_sample_rates = EXCLUDED.supported_sample_rates,
          last_heartbeat_at = EXCLUDED.last_heartbeat_at,
          status = CASE WHEN device.status = 'offline' THEN 'ready'
            ELSE device.status END,
          version = device.version + 1,
          updated_at = now()
        RETURNING *
      `, [input.deviceId, input.firmwareVersion, input.protocolVersion,
        input.supportedSampleRates, input.observedAt.toISOString()]);
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL Air device registration returned no row");
      return fromDeviceRow(row);
    } finally {
      client.release();
    }
  }

  async processHeartbeat(
    client: Pick<PoolClient, "query">,
    input: AirDeviceHeartbeatRequest & { leaseTtlSeconds: number },
  ) {
    if (input.activeBinding) {
      const current = await client.query(`
        SELECT 1 FROM ai_phone.air_device_calls
        WHERE provider_call_id = $1 AND communication_session_id = $2
          AND device_id = $3 AND lease_id = $4 AND fencing_token = $5
          AND call_generation = $6
          AND ai_phone.air_device_lease_is_current($3, $4, $5)
        FOR UPDATE
      `, [input.activeBinding.providerCallId,
        input.activeBinding.communicationSessionId,
        input.activeBinding.deviceId, input.activeBinding.leaseId,
        input.activeBinding.fencingToken, input.activeBinding.callGeneration]);
      if (current.rowCount !== 1) {
        throw new DeviceLeaseConflict("Stale Air device heartbeat binding");
      }
    }

    // A carrier terminal event can be lost after a user hangup.  The board's
    // ready heartbeat is the only safe recovery signal: only recover calls
    // whose lease is already expired and for which no newer lease exists.
    // Never recover an in-call heartbeat or a device with an active lease.
    const recoveredStaleCalls = input.deviceState === "ready" && !input.activeBinding
      ? await client.query<{ provider_call_id: string }>(`
        WITH stale_calls AS (
          SELECT c.provider_call_id, c.communication_session_id,
            c.provider_operation_id
          FROM ai_phone.air_device_calls AS c
          JOIN ai_phone.air_device_leases AS lease
            ON lease.device_id = c.device_id
            AND lease.lease_id = c.lease_id
            AND lease.fencing_token = c.fencing_token
          WHERE c.device_id = $1
            AND c.carrier_state IN ('dialing', 'ringing', 'connected', 'unknown')
            AND (lease.status = 'expired' OR
              (lease.status = 'active' AND lease.expires_at <= now()))
            AND NOT EXISTS (
              SELECT 1 FROM ai_phone.air_device_leases AS newer
              WHERE newer.device_id = c.device_id
                AND newer.status = 'active' AND newer.expires_at > now()
            )
        ), updated_calls AS (
          UPDATE ai_phone.air_device_calls AS c
          SET carrier_state = 'failed', ended_at = COALESCE(c.ended_at, now()),
            version = c.version + 1, updated_at = now()
          FROM stale_calls AS stale
          WHERE c.provider_call_id = stale.provider_call_id
            AND c.carrier_state IN ('dialing', 'ringing', 'connected', 'unknown')
          RETURNING c.provider_call_id, c.communication_session_id,
            c.provider_operation_id, c.version, c.device_id, c.lease_id,
            c.fencing_token, c.call_generation
        ), updated_operations AS (
          UPDATE ai_phone.provider_operations AS operation
          SET status = 'failed', last_error_class = 'carrier_reconciliation_unknown',
            completion_observed_at = COALESCE(operation.completion_observed_at, now()),
            completion_observed_event = 'heartbeat_ready_recovery',
            ended_at = COALESCE(operation.ended_at, now()),
            version = operation.version + 1, updated_at = now()
          FROM updated_calls AS call
          WHERE operation.session_id = call.communication_session_id
            AND operation.provider = 'air780_volte'
            AND operation.operation_type IN ('phone_outbound', 'phone_hangup')
            AND operation.status IN ('in_flight', 'accepted', 'active', 'unknown')
          RETURNING operation.id
        ), outboxed AS (
          INSERT INTO ai_phone.reliable_outbox_events(
            id, idempotency_key, session_id, aggregate_version, sequence,
            event_type, event_version, payload
          )
          SELECT 'air-call-recovered-' || call.provider_call_id,
            'air-call-recovered-' || call.provider_call_id,
            call.communication_session_id, call.version, call.version,
            'device.call.failed', 1,
            jsonb_build_object(
              'providerCallId', call.provider_call_id,
              'deviceId', call.device_id,
              'leaseId', call.lease_id,
              'fencingToken', call.fencing_token,
              'callGeneration', call.call_generation,
              'reason', 'heartbeat_ready_recovery'
            )
          FROM updated_calls AS call
          ON CONFLICT(idempotency_key) DO NOTHING
          RETURNING id
        )
        SELECT provider_call_id FROM updated_calls
      `, [input.deviceId])
      : { rowCount: 0, rows: [] };
    const recoveredDevice = (recoveredStaleCalls.rowCount ?? 0) > 0;

    const registered = await client.query<DeviceRow>(`
      INSERT INTO ai_phone.air_devices AS device(
        device_id, firmware_version, protocol_version,
        supported_sample_rates, status, last_heartbeat_at,
        boot_id, heartbeat_sequence, device_uptime_ms,
        heartbeat_observed_at
      ) VALUES ($1, $2, $3, $4,
        CASE WHEN $8 IN ('ready', 'in_call') THEN 'ready' ELSE $8 END,
        now(), $5, $6, $7, $9::timestamptz)
      ON CONFLICT(device_id) DO UPDATE SET
        firmware_version = EXCLUDED.firmware_version,
        protocol_version = EXCLUDED.protocol_version,
        supported_sample_rates = EXCLUDED.supported_sample_rates,
        last_heartbeat_at = now(),
        boot_id = EXCLUDED.boot_id,
        heartbeat_sequence = EXCLUDED.heartbeat_sequence,
        device_uptime_ms = EXCLUDED.device_uptime_ms,
        heartbeat_observed_at = EXCLUDED.heartbeat_observed_at,
        status = CASE
          WHEN EXCLUDED.status IN ('quarantined', 'fault') THEN EXCLUDED.status
          WHEN $10::boolean AND device.status = 'quarantined' THEN 'ready'
          WHEN device.status = 'offline' THEN 'ready'
          ELSE device.status END,
        version = device.version + 1,
        updated_at = now()
      WHERE device.boot_id IS NULL OR (
        EXCLUDED.heartbeat_observed_at >= device.heartbeat_observed_at AND (
          EXCLUDED.boot_id <> device.boot_id OR (
            EXCLUDED.heartbeat_sequence > device.heartbeat_sequence AND
            EXCLUDED.device_uptime_ms > device.device_uptime_ms
          )
        )
      )
      RETURNING *
    `, [input.deviceId, input.firmwareVersion, input.protocolVersion,
      input.supportedSampleRates, input.bootId, input.heartbeatSequence,
      input.uptimeMs, input.deviceState, input.observedAt, recoveredDevice]);
    const device = registered.rows[0];
    if (!device) throw new DeviceLeaseConflict("Stale Air device heartbeat");

    if (input.activeBinding) {
      const renewed = await client.query<LeaseRow>(`
        SELECT * FROM ai_phone.renew_air_device_lease($1, $2, $3, $4)
      `, [input.activeBinding.deviceId, input.activeBinding.leaseId,
        input.activeBinding.fencingToken, input.leaseTtlSeconds]);
      if (!renewed.rows[0]) {
        throw new DeviceLeaseConflict("Stale Air device lease renewal");
      }
    }
    return {
      registration: fromDeviceRow(device),
      leaseRenewed: Boolean(input.activeBinding),
    };
  }

  async claim(input: {
    communicationSessionId: string;
    leaseId: string;
    ownerId: string;
    ttlSeconds: number;
    heartbeatFreshnessSeconds: number;
  }): Promise<PostgresAirDeviceLease> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<LeaseRow>(`
        SELECT * FROM ai_phone.claim_air_device($1, $2, $3, $4, $5)
      `, [
        input.communicationSessionId,
        input.leaseId,
        input.ownerId,
        input.ttlSeconds,
        input.heartbeatFreshnessSeconds,
      ]);
      const row = result.rows[0];
      if (!row) throw new DeviceLeaseConflict("No ready Air device");
      return fromLeaseRow(row);
    } finally {
      client.release();
    }
  }

  async findActiveLease(
    communicationSessionId: string,
  ): Promise<PostgresAirDeviceLease | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<LeaseRow>(`
        SELECT * FROM ai_phone.air_device_leases
        WHERE communication_session_id = $1 AND status = 'active'
          AND expires_at > now()
        LIMIT 1
      `, [communicationSessionId]);
      return result.rows[0] ? fromLeaseRow(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async assertLease(input: {
    deviceId: string;
    leaseId: string;
    fencingToken: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<CurrentRow>(`
        SELECT ai_phone.air_device_lease_is_current($1, $2, $3) AS current
      `, [input.deviceId, input.leaseId, input.fencingToken]);
      if (result.rows[0]?.current !== true) {
        throw new DeviceLeaseConflict("Stale Air device lease");
      }
    } finally {
      client.release();
    }
  }

  async renew(input: {
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    ttlSeconds: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<LeaseRow>(`
        SELECT * FROM ai_phone.renew_air_device_lease($1, $2, $3, $4)
      `, [input.deviceId, input.leaseId, input.fencingToken, input.ttlSeconds]);
      const row = result.rows[0];
      if (!row) throw new DeviceLeaseConflict("Stale Air device lease renewal");
      return fromLeaseRow(row);
    } finally {
      client.release();
    }
  }

  async release(input: {
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    heartbeatFreshnessSeconds: number;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<ReleasedRow>(`
        SELECT ai_phone.release_air_device_lease($1, $2, $3, $4) AS released
      `, [input.deviceId, input.leaseId, input.fencingToken,
        input.heartbeatFreshnessSeconds]);
      return result.rows[0]?.released === true;
    } finally {
      client.release();
    }
  }
}
