import { describe, expect, it, vi } from "vitest";
import type {
  EnterpriseRepositoryRuntime,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  RepositoryRuntime,
} from "../storage/repository-runtime.js";
import {
  initializeEnterprisePrimaryRuntime,
} from "./enterprise-primary-runtime.js";

describe("enterprise Primary Runtime", () => {
  it("keeps legacy storage under one driver and closes both runtimes once", async () => {
    const platformClose = vi.fn(async () => undefined);
    const enterpriseClose = vi.fn(async () => undefined);
    const runtime = await initializeEnterprisePrimaryRuntime({
      env: {
        API_STORAGE_DRIVER: "sqlite",
        ENTERPRISE_REPOSITORY_DRIVER: "legacy",
      },
      initializePlatform: async () => legacyPlatform(platformClose),
      runEnterpriseStartup: async () => ({
        status: "disabled",
        mode: "disabled",
      }),
      createEnterpriseRuntime: () => enterpriseRuntime(
        "legacy",
        enterpriseClose,
      ),
    });

    expect(runtime.driver).toBe("legacy");
    await runtime.close();
    await runtime.close();
    expect(enterpriseClose).toHaveBeenCalledOnce();
    expect(platformClose).toHaveBeenCalledOnce();
  });

  it("accepts one PostgreSQL database and one combined startup verdict", async () => {
    const platformClose = vi.fn(async () => undefined);
    const enterpriseClose = vi.fn(async () => undefined);
    const runtime = await initializeEnterprisePrimaryRuntime({
      env: {
        API_STORAGE_DRIVER: "postgres",
        ENTERPRISE_REPOSITORY_DRIVER: "postgres",
      },
      initializePlatform: async () => postgresPlatform(
        { name: "ai_phone", oid: "42" },
        platformClose,
      ),
      runEnterpriseStartup: async () => verifiedStartup({
        name: "ai_phone",
        oid: "42",
      }),
      createEnterpriseRuntime: () => enterpriseRuntime(
        "postgres",
        enterpriseClose,
      ),
    });

    expect(runtime).toMatchObject({
      driver: "postgres",
      startup: {
        status: "verified",
        evidence: { database: { name: "ai_phone", oid: "42" } },
      },
    });
    await runtime.close();
    expect(enterpriseClose).toHaveBeenCalledOnce();
    expect(platformClose).toHaveBeenCalledOnce();
  });

  it("fails closed when the public and enterprise schemas use different databases", async () => {
    const platformClose = vi.fn(async () => undefined);
    await expect(initializeEnterprisePrimaryRuntime({
      env: { API_STORAGE_DRIVER: "postgres" },
      initializePlatform: async () => postgresPlatform(
        { name: "ai_phone", oid: "42" },
        platformClose,
      ),
      runEnterpriseStartup: async () => verifiedStartup({
        name: "enterprise_other",
        oid: "84",
      }),
      createEnterpriseRuntime: () => enterpriseRuntime("postgres"),
    })).rejects.toThrow("must use the same PostgreSQL database");
    expect(platformClose).toHaveBeenCalledOnce();
  });

  it("refuses PostgreSQL when either schema startup verdict is missing", async () => {
    const platformClose = vi.fn(async () => undefined);
    await expect(initializeEnterprisePrimaryRuntime({
      env: { API_STORAGE_DRIVER: "postgres" },
      initializePlatform: async () => postgresPlatform(
        { name: "ai_phone", oid: "42" },
        platformClose,
      ),
      runEnterpriseStartup: async () => ({
        status: "disabled",
        mode: "disabled",
      }),
      createEnterpriseRuntime: () => enterpriseRuntime("postgres"),
    })).rejects.toThrow("requires enterprise schema verification");
    expect(platformClose).toHaveBeenCalledOnce();
  });
});

function legacyPlatform(close = vi.fn(async () => undefined)) {
  return { driver: "sqlite", close } as RepositoryRuntime;
}

function postgresPlatform(
  database: { name: string; oid: string },
  close = vi.fn(async () => undefined),
) {
  return {
    driver: "postgres",
    postgres: { pool: {} },
    primaryStartup: {
      status: "ready",
      cutoverId: "cutover-1",
      migrations: 30,
      database,
    },
    close,
  } as unknown as RepositoryRuntime;
}

function enterpriseRuntime(
  driver: "legacy" | "postgres",
  close = vi.fn(async () => undefined),
) {
  return { driver, close } as EnterpriseRepositoryRuntime;
}

function verifiedStartup(database: { name: string; oid: string }) {
  return {
    status: "verified" as const,
    mode: "verify" as const,
    evidence: {
      migrations: 11,
      tenantTables: 33,
      compositeForeignKeys: 12,
      subjectColumns: 12,
      rls: "forced",
      database,
    },
  };
}
