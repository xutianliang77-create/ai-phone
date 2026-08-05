import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  AirDeviceHeartbeatRequest,
  AirDeviceRegistrationDto,
} from "@translation/contracts";
import { DeviceLeaseConflict } from "./device-lease-registry.js";

export interface PostgresAirDeviceLease {
  deviceId: string;
  leaseId: string;
  communicationSessionId: string;
  ownerId: string;
  fencingToken: number;
  expiresAt: string;
  version: number;
}

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
      input.uptimeMs, input.deviceState, input.observedAt]);
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

interface LeaseRow extends QueryResultRow {
  device_id: string;
  lease_id: string;
  communication_session_id: string;
  owner_id: string;
  fencing_token: string;
  expires_at: Date;
  version: string;
}

interface CurrentRow extends QueryResultRow {
  current: boolean;
}

interface ReleasedRow extends QueryResultRow {
  released: boolean;
}

interface DeviceRow extends QueryResultRow {
  device_id: string;
  firmware_version: string;
  protocol_version: string;
  supported_sample_rates: number[];
  status: AirDeviceRegistrationDto["status"];
  last_heartbeat_at: Date;
  fencing_token: string;
  version: string;
}

function fromDeviceRow(row: DeviceRow): AirDeviceRegistrationDto {
  const fencingToken = Number(row.fencing_token);
  const version = Number(row.version);
  const supportedSampleRates = row.supported_sample_rates.filter(
    (rate): rate is 8_000 | 16_000 => rate === 8_000 || rate === 16_000,
  );
  if (!row.device_id || !row.firmware_version || !row.protocol_version ||
    supportedSampleRates.length !== row.supported_sample_rates.length ||
    !Number.isSafeInteger(fencingToken) || fencingToken < 0 ||
    !Number.isSafeInteger(version) || version < 1 ||
    !(row.last_heartbeat_at instanceof Date) ||
    !Number.isFinite(row.last_heartbeat_at.getTime())) {
    throw new Error("Invalid PostgreSQL Air device registration");
  }
  return {
    deviceId: row.device_id,
    firmwareVersion: row.firmware_version,
    protocolVersion: row.protocol_version,
    supportedSampleRates,
    status: row.status,
    lastHeartbeatAt: row.last_heartbeat_at.toISOString(),
    fencingToken,
    version,
  };
}

function fromLeaseRow(row: LeaseRow): PostgresAirDeviceLease {
  const fencingToken = Number(row.fencing_token);
  const version = Number(row.version);
  if (!row.device_id || !row.lease_id || !row.communication_session_id ||
    !row.owner_id || !Number.isSafeInteger(fencingToken) || fencingToken < 1 ||
    !Number.isSafeInteger(version) || version < 1 ||
    !(row.expires_at instanceof Date) || !Number.isFinite(row.expires_at.getTime())) {
    throw new Error("Invalid PostgreSQL Air device lease");
  }
  return {
    deviceId: row.device_id,
    leaseId: row.lease_id,
    communicationSessionId: row.communication_session_id,
    ownerId: row.owner_id,
    fencingToken,
    expiresAt: row.expires_at.toISOString(),
    version,
  };
}
