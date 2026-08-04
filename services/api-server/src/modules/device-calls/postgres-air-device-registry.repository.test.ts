import { describe, expect, it, vi } from "vitest";
import { DeviceLeaseConflict } from "./device-lease-registry.js";
import { PostgresAirDeviceRegistryRepository } from
  "./postgres-air-device-registry.repository.js";

describe("PostgreSQL Air device registry", () => {
  it("refreshes registration without clearing quarantine", async () => {
    const fixture = pool([deviceRow]);
    const repository = new PostgresAirDeviceRegistryRepository(fixture.pool);

    await expect(repository.register({
      deviceId: "air-001",
      firmwareVersion: "V2046-113",
      protocolVersion: "vuart-v1",
      supportedSampleRates: [16_000],
      observedAt: new Date("2026-08-04T03:00:00.000Z"),
    })).resolves.toMatchObject({
      deviceId: "air-001",
      status: "quarantined",
      fencingToken: 7,
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("status = CASE"),
      ["air-001", "V2046-113", "vuart-v1", [16_000],
        "2026-08-04T03:00:00.000Z"],
    );
  });

  it("claims through the atomic fenced database function", async () => {
    const fixture = pool([{ ...leaseRow }]);
    const repository = new PostgresAirDeviceRegistryRepository(fixture.pool);

    await expect(repository.claim({
      communicationSessionId: "session-1",
      leaseId: "lease-1",
      ownerId: "gateway-instance-1",
      ttlSeconds: 30,
      heartbeatFreshnessSeconds: 30,
    })).resolves.toEqual({
      deviceId: "air-001",
      leaseId: "lease-1",
      communicationSessionId: "session-1",
      ownerId: "gateway-instance-1",
      fencingToken: 7,
      expiresAt: "2026-08-04T03:00:30.000Z",
      version: 1,
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining("ai_phone.claim_air_device"),
      ["session-1", "lease-1", "gateway-instance-1", 30, 30],
    );
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("rejects a stale lease returned by the database assertion", async () => {
    const fixture = pool([{ current: false }]);
    const repository = new PostgresAirDeviceRegistryRepository(fixture.pool);

    await expect(repository.assertLease({
      deviceId: "air-001",
      leaseId: "lease-old",
      fencingToken: 6,
    })).rejects.toBeInstanceOf(DeviceLeaseConflict);
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("renews and releases only the exact current fence", async () => {
    const renewal = pool([{ ...leaseRow, version: "2" }]);
    const renewRepository = new PostgresAirDeviceRegistryRepository(renewal.pool);
    await expect(renewRepository.renew({
      deviceId: "air-001",
      leaseId: "lease-1",
      fencingToken: 7,
      ttlSeconds: 30,
    })).resolves.toMatchObject({ leaseId: "lease-1", version: 2 });
    expect(renewal.query).toHaveBeenCalledWith(
      expect.stringContaining("ai_phone.renew_air_device_lease"),
      ["air-001", "lease-1", 7, 30],
    );

    const released = pool([{ released: true }]);
    const releaseRepository = new PostgresAirDeviceRegistryRepository(released.pool);
    await expect(releaseRepository.release({
      deviceId: "air-001",
      leaseId: "lease-1",
      fencingToken: 7,
      heartbeatFreshnessSeconds: 30,
    })).resolves.toBe(true);
    expect(released.query).toHaveBeenCalledWith(
      expect.stringContaining("ai_phone.release_air_device_lease"),
      ["air-001", "lease-1", 7, 30],
    );
  });
});

const leaseRow = {
  device_id: "air-001",
  lease_id: "lease-1",
  communication_session_id: "session-1",
  owner_id: "gateway-instance-1",
  fencing_token: "7",
  expires_at: new Date("2026-08-04T03:00:30.000Z"),
  version: "1",
};

const deviceRow = {
  device_id: "air-001",
  firmware_version: "V2046-113",
  protocol_version: "vuart-v1",
  supported_sample_rates: [16_000],
  status: "quarantined",
  last_heartbeat_at: new Date("2026-08-04T03:00:00.000Z"),
  fencing_token: "7",
  version: "3",
};

function pool(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { pool: { connect } as never, query, release };
}
