import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createEnvironmentTenantLifecycleExecutor,
  type TenantLifecycleExecutionInput,
} from "./enterprise-tenant-lifecycle-executor.js";

describe("enterprise tenant lifecycle executor", () => {
  it("fails explicitly when no executor is configured", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const executor = createEnvironmentTenantLifecycleExecutor({
      env: {},
      fetcher,
    });

    await expect(executor.execute(executionInput("tenant.export", "job-a")))
      .resolves.toEqual({ status: "failed", reason: "executor_not_configured" });
    expect(fetcher).not.toHaveBeenCalled();

    const invalid = createEnvironmentTenantLifecycleExecutor({
      env: {
        ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_URL: "http://localhost/jobs",
        ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_TOKEN: "executor-token",
      },
      fetcher,
    });
    await expect(invalid.execute(executionInput("tenant.export", "job-a")))
      .resolves.toEqual({
        status: "failed",
        reason: "executor_configuration_invalid",
      });
  });

  it("accepts only a matching HTTPS executor receipt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        status: "completed",
        tenantId: "tenant-a",
        jobId: "job-a",
        receiptRef: "object:export-a",
        receiptHash: "a".repeat(64),
      }),
      { status: 200 },
    ));
    const executor = createEnvironmentTenantLifecycleExecutor({
      env: {
        ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_URL:
          "https://lifecycle.enterprise.example/jobs",
        ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_TOKEN: "executor-token",
      },
      fetcher,
    });

    await expect(executor.execute(executionInput("tenant.export", "job-a")))
      .resolves.toEqual({
        status: "completed",
        receiptRef: "object:export-a",
        receiptHash: "a".repeat(64),
      });
    expect(fetcher.mock.calls[0]?.[0])
      .toBe("https://lifecycle.enterprise.example/jobs");
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer executor-token",
      "idempotency-key": "job-a",
    });

    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      status: "completed",
      tenantId: "tenant-b",
      jobId: "job-a",
      receiptRef: "object:export-a",
      receiptHash: "a".repeat(64),
    }), { status: 200 }));
    await expect(executor.execute(executionInput("tenant.export", "job-a")))
      .resolves.toEqual({
        status: "failed",
        reason: "invalid_executor_receipt",
      });
  });

  it("keeps accepted and transient executor results retryable", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const executor = createEnvironmentTenantLifecycleExecutor({
      env: {
        ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_URL:
          "https://lifecycle.enterprise.example/jobs",
        ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_TOKEN: "executor-token",
      },
      fetcher,
    });

    await expect(executor.execute(executionInput("tenant.export", "job-a")))
      .resolves.toEqual({ status: "processing" });
    await expect(executor.execute(executionInput("tenant.export", "job-a")))
      .resolves.toEqual({ status: "retry", reason: "executor_unavailable" });
  });

  it("requires database, object and provider convergence for tenant deletion", async () => {
    const convergence = {
      schemaVersion: 1, tenantId: "tenant-a", jobId: "job-delete",
      database: { status: "tombstoned", manifestHash: "a".repeat(64) },
      objects: { status: "converged", discoveredCount: 2, deletedCount: 1,
        alreadyAbsentCount: 1, remainingCount: 0, manifestHash: "b".repeat(64) },
      providers: { status: "converged", discoveredCount: 1, deletedCount: 1,
        alreadyAbsentCount: 0, remainingCount: 0, manifestHash: "c".repeat(64) },
      verifiedAt: "2026-07-20T10:00:00.000Z",
    };
    const receiptHash = createHash("sha256")
      .update(JSON.stringify(convergence)).digest("hex");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ status: "completed", tenantId: "tenant-a",
        jobId: "job-delete", receiptRef: "deletion:job-delete",
        receiptHash, convergence }), { status: 200 },
    ));
    const executor = createEnvironmentTenantLifecycleExecutor({
      env: { ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_URL:
        "https://lifecycle.enterprise.example/jobs",
        ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_TOKEN: "executor-token" },
      fetcher,
    });
    await expect(executor.execute(executionInput("tenant.delete", "job-delete")))
      .resolves.toMatchObject({ status: "completed", receiptHash });

    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      status: "completed", tenantId: "tenant-a", jobId: "job-delete",
      receiptRef: "deletion:job-delete", receiptHash,
      convergence: { ...convergence, objects: {
        ...convergence.objects, remainingCount: 1,
      } },
    }), { status: 200 }));
    await expect(executor.execute(executionInput("tenant.delete", "job-delete")))
      .resolves.toEqual({ status: "failed", reason: "deletion_not_converged" });
  });

  it("writes and deletes real demo artifacts only outside production", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tenant-lifecycle-"));
    try {
      const executor = createEnvironmentTenantLifecycleExecutor({
        env: {
          NODE_ENV: "development",
          ENTERPRISE_TENANT_LIFECYCLE_LOCAL_DIR: directory,
        },
      });
      const exported = await executor.execute(executionInput("tenant.export", "job-a"));
      expect(exported).toMatchObject({
        status: "completed",
        receiptRef: "local-export:job-a",
      });
      const exportFile = join(
        directory,
        "tenants",
        "tenant-a",
        "exports",
        "job-a.json",
      );
      expect(existsSync(exportFile)).toBe(true);
      const exportContent = readFileSync(exportFile, "utf8");
      expect(exportContent).toContain("\"tenant-a\"");
      expect(exportContent).toContain("\"tenantJobs\"");
      expect(exportContent).not.toContain("idempotencyKey");

      const deleted = await executor.execute(executionInput("tenant.delete", "job-b"));
      expect(deleted).toMatchObject({
        status: "completed",
        receiptRef: "local-delete:job-b",
      });
      expect(existsSync(join(directory, "tenants", "tenant-a"))).toBe(false);
      expect(existsSync(join(directory, "receipts", "job-b.json"))).toBe(true);

      const forbidden = createEnvironmentTenantLifecycleExecutor({
        env: {
          NODE_ENV: "production",
          ENTERPRISE_TENANT_LIFECYCLE_LOCAL_DIR: directory,
        },
      });
      await expect(forbidden.execute(executionInput("tenant.export", "job-c")))
        .resolves.toEqual({
          status: "failed",
          reason: "local_executor_forbidden",
        });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function executionInput(
  type: "tenant.export" | "tenant.delete",
  id: string,
): TenantLifecycleExecutionInput {
  return {
    job: { id, tenantId: "tenant-a", type, attempt: 1 },
    snapshot: {
      requestedAt: "2026-07-16T00:00:00.000Z",
      actor: {
        userId: "owner-user",
        role: "owner",
        scopes: ["tenant:read", "tenant:write"],
      },
      tenant: {
        id: "tenant-a",
        name: "Tenant A",
        status: type === "tenant.delete" ? "deletion_requested" : "active",
        homeRegion: "cn",
        cellId: "cn-cell-01",
        planCode: "enterprise_trial",
        dataRetentionDays: 30,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
        version: 2,
      },
      members: [{
        id: "member-a",
        tenantId: "tenant-a",
        userId: "owner-user",
        role: "owner",
        status: "active",
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
        version: 1,
      }],
      tenantJobs: [{
        id,
        tenantId: "tenant-a",
        actorUserId: "owner-user",
        type,
        status: "processing",
        attempts: 1,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }],
    },
  };
}
