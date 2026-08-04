import { randomUUID } from "node:crypto";

export interface AirDeviceLease {
  deviceId: string;
  leaseId: string;
  communicationSessionId: string;
  fencingToken: number;
  expiresAtMs: number;
}

interface AirDeviceRecord {
  deviceId: string;
  firmwareVersion: string;
  sampleRates: Array<8_000 | 16_000>;
  lastSeenAtMs: number;
  fencingToken: number;
  activeLease?: AirDeviceLease;
  status: "ready" | "reserved" | "quarantined";
}

export class DeviceLeaseConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceLeaseConflict";
  }
}

export class MemoryAirDeviceRegistry {
  private readonly devices = new Map<string, AirDeviceRecord>();

  constructor(
    private readonly idFactory: () => string = randomUUID,
    private readonly heartbeatFreshnessMs = 30_000,
  ) {}

  register(input: {
    deviceId: string;
    firmwareVersion: string;
    sampleRates: Array<8_000 | 16_000>;
    nowMs: number;
  }) {
    const current = this.devices.get(input.deviceId);
    const record: AirDeviceRecord = {
      deviceId: input.deviceId,
      firmwareVersion: input.firmwareVersion,
      sampleRates: [...new Set(input.sampleRates)],
      lastSeenAtMs: input.nowMs,
      fencingToken: current?.fencingToken ?? 0,
      activeLease: current?.activeLease,
      status: current?.activeLease ? "reserved" : current?.status ?? "ready",
    };
    this.devices.set(input.deviceId, record);
    return this.snapshot(record);
  }

  claim(input: {
    communicationSessionId: string;
    nowMs: number;
    ttlMs: number;
  }): AirDeviceLease {
    this.expireLeases(input.nowMs);
    for (const device of this.devices.values()) {
      if (device.activeLease?.communicationSessionId ===
        input.communicationSessionId) return { ...device.activeLease };
    }
    const device = [...this.devices.values()]
      .filter((candidate) => candidate.status === "ready" &&
        input.nowMs - candidate.lastSeenAtMs <= this.heartbeatFreshnessMs)
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId))[0];
    if (!device) throw new DeviceLeaseConflict("No ready Air device");
    device.fencingToken += 1;
    device.status = "reserved";
    device.activeLease = {
      deviceId: device.deviceId,
      leaseId: this.idFactory(),
      communicationSessionId: input.communicationSessionId,
      fencingToken: device.fencingToken,
      expiresAtMs: input.nowMs + input.ttlMs,
    };
    return { ...device.activeLease };
  }

  assertLease(input: {
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    nowMs: number;
  }) {
    const lease = this.devices.get(input.deviceId)?.activeLease;
    if (!lease || lease.leaseId !== input.leaseId ||
      lease.fencingToken !== input.fencingToken ||
      lease.expiresAtMs <= input.nowMs) {
      throw new DeviceLeaseConflict("Stale Air device lease");
    }
  }

  release(input: { leaseId: string; fencingToken: number; nowMs: number }) {
    const device = [...this.devices.values()].find(
      (candidate) => candidate.activeLease?.leaseId === input.leaseId,
    );
    if (!device || device.activeLease?.fencingToken !== input.fencingToken) {
      throw new DeviceLeaseConflict("Stale Air device lease release");
    }
    device.activeLease = undefined;
    device.status = "ready";
  }

  private expireLeases(nowMs: number) {
    for (const device of this.devices.values()) {
      if (device.activeLease && device.activeLease.expiresAtMs <= nowMs) {
        device.activeLease = undefined;
        device.status = "quarantined";
      }
    }
  }

  private snapshot(record: AirDeviceRecord) {
    return {
      ...record,
      sampleRates: [...record.sampleRates],
      ...(record.activeLease ? { activeLease: { ...record.activeLease } } : {}),
    };
  }
}
