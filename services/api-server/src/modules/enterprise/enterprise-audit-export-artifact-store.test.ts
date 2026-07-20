import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEnvironmentAuditExportArtifactStore } from
  "./enterprise-audit-export-artifact-store.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const exportId = "00000000-0000-4000-8000-000000000002";

describe("enterprise audit export artifact lifecycle", () => {
  it("physically deletes a local demo artifact and converges when replayed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "audit-export-lifecycle-"));
    const store = createEnvironmentAuditExportArtifactStore({
      NODE_ENV: "development",
      ENTERPRISE_AUDIT_EXPORT_ENABLED: "true",
      ENTERPRISE_AUDIT_EXPORT_LOCAL_DIR: directory,
    });
    try {
      const written = await store.put({
        tenantId, exportId, content: "{}\n",
        expiresAt: "2026-07-21T00:00:00.000Z",
      });
      expect(written.status).toBe("stored");
      if (written.status !== "stored") throw new Error("artifact not stored");
      await expect(store.delete(written.objectKey)).resolves.toMatchObject({
        status: "converged", outcome: "deleted",
      });
      await expect(store.get(written.objectKey)).resolves.toMatchObject({
        status: "not_found",
      });
      await expect(store.delete(written.objectKey)).resolves.toMatchObject({
        status: "converged", outcome: "already_absent",
      });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed for an invalid key and retries when storage is disabled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "audit-export-lifecycle-"));
    try {
      const local = createEnvironmentAuditExportArtifactStore({
        NODE_ENV: "development", ENTERPRISE_AUDIT_EXPORT_ENABLED: "true",
        ENTERPRISE_AUDIT_EXPORT_LOCAL_DIR: directory,
      });
      await expect(local.delete("../outside.jsonl")).resolves.toEqual({
        status: "failed", reasonCode: "audit_export_artifact_key_invalid",
      });
      local.close();
      const disabled = createEnvironmentAuditExportArtifactStore({});
      await expect(disabled.delete("ignored")).resolves.toEqual({
        status: "retry", reasonCode: "audit_export_disabled",
      });
      disabled.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
