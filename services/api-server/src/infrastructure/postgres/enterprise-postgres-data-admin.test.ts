import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runEnterprisePostgresDataAdmin,
} from "./enterprise-postgres-data-admin.js";

afterEach(() => vi.unstubAllEnvs());

describe("enterprise PostgreSQL data admin", () => {
  it("fails before reading or connecting outside a maintenance window", async () => {
    vi.stubEnv("ENTERPRISE_POSTGRES_DATA_MAINTENANCE", "");
    await expect(runEnterprisePostgresDataAdmin(
      "import",
      "json",
      "/missing/source.json",
    )).rejects.toThrow("API and workers are stopped");
  });

  it("validates the command before creating a PostgreSQL client", async () => {
    vi.stubEnv("ENTERPRISE_POSTGRES_DATA_MAINTENANCE", "true");
    await expect(runEnterprisePostgresDataAdmin(
      "replace",
      "json",
      "/missing/source.json",
    )).rejects.toThrow("Usage:");
  });
});
