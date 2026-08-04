import type { Pool, QueryResultRow } from "pg";
import type { AirDeviceRegistrationDto } from "@translation/contracts";
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
