import { describe, expect, it } from "vitest";
import {
  loadEnterprisePostgresWorkerConfig,
} from "./enterprise-postgres-worker-config.js";

describe("enterprise PostgreSQL worker config", () => {
  it("requires a PostgreSQL driver and explicit cell identity", () => {
    expect(() => loadEnterprisePostgresWorkerConfig({})).toThrow(
      "requires PostgreSQL",
    );
    expect(() => loadEnterprisePostgresWorkerConfig({
      ENTERPRISE_REPOSITORY_DRIVER: "postgres",
    })).toThrow("cellId");
  });

  it("loads bounded worker defaults", () => {
    expect(loadEnterprisePostgresWorkerConfig({
      ENTERPRISE_REPOSITORY_DRIVER: "postgres",
      ENTERPRISE_WORKER_CELL_ID: "cn-cell-01",
      ENTERPRISE_WORKER_ID: "worker-01",
    })).toEqual({
      cellId: "cn-cell-01",
      workerId: "worker-01",
      pollIntervalMs: 5_000,
      batchSize: 25,
      leaseMs: 30_000,
    });
  });

  it("rejects invalid limits instead of silently clamping them", () => {
    expect(() => loadEnterprisePostgresWorkerConfig({
      ENTERPRISE_REPOSITORY_DRIVER: "postgres",
      ENTERPRISE_WORKER_CELL_ID: "cn-cell-01",
      ENTERPRISE_WORKER_ID: "worker-01",
      ENTERPRISE_WORKER_BATCH_SIZE: "101",
    })).toThrow("ENTERPRISE_WORKER_BATCH_SIZE");
  });
});
