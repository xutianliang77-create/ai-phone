import type { QueryResultRow } from "pg";
import type { AirDeviceRegistrationDto } from "@translation/contracts";

export interface PostgresAirDeviceLease {
  deviceId: string;
  leaseId: string;
  communicationSessionId: string;
  ownerId: string;
  fencingToken: number;
  expiresAt: string;
  version: number;
}

export interface LeaseRow extends QueryResultRow {
  device_id: string;
  lease_id: string;
  communication_session_id: string;
  owner_id: string;
  fencing_token: string;
  expires_at: Date;
  version: string;
}

export interface CurrentRow extends QueryResultRow { current: boolean }

export interface ReleasedRow extends QueryResultRow { released: boolean }

export interface DeviceRow extends QueryResultRow {
  device_id: string;
  firmware_version: string;
  protocol_version: string;
  supported_sample_rates: number[];
  status: AirDeviceRegistrationDto["status"];
  last_heartbeat_at: Date;
  fencing_token: string;
  version: string;
}

export function fromDeviceRow(row: DeviceRow): AirDeviceRegistrationDto {
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

export function fromLeaseRow(row: LeaseRow): PostgresAirDeviceLease {
  const fencingToken = Number(row.fencing_token);
  const version = Number(row.version);
  if (!row.device_id || !row.lease_id || !row.communication_session_id ||
    !row.owner_id || !Number.isSafeInteger(fencingToken) || fencingToken < 1 ||
    !Number.isSafeInteger(version) || version < 1 ||
    !(row.expires_at instanceof Date) ||
    !Number.isFinite(row.expires_at.getTime())) {
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
