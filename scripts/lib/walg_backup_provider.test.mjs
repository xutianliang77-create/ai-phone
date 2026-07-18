import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runWalgBackupProviderStep } from "./walg_backup_provider.mjs";

function config(root) {
  return {
    sourceDatabase: "ai_phone_staging",
    restoreDatabase: "ai_phone_restore_drill_01",
    restoreDataDirectory: path.join(root, "ai_phone_restore_drill_01"),
    stateDirectory: "outputs/postgres-resilience/walg-state",
    writerPgService: "ai-phone-writer",
    restorePgService: "ai-phone-restore",
    retentionDays: 30,
  };
}

function runtime() {
  let created = false;
  return {
    backupList: vi.fn(async () => created ?
      [{ id: "base_00000001", raw: {} }] : []),
    backupPush: vi.fn(async () => { created = true; }),
    storageAttestation: vi.fn(async (action) => action === "verify-backup" ? {
      status: "passed",
      offHost: true,
      encryptedInTransit: true,
      encryptedAtRest: true,
      immutable: true,
      retentionDays: 35,
      checksumSha256: "a".repeat(64),
      objectVersionId: "object-version-1",
    } : {
      status: "passed",
      lastArchivedWal: "000000010000000000000001",
      unresolvedArchiveFailures: 0,
      maxObservedArchiveLagSeconds: 2,
      objectVersionId: "wal-version-1",
    }),
    switchWal: vi.fn(async () => ({
      lastArchivedWal: "000000010000000000000001",
    })),
    walShow: vi.fn(async () => ({})),
    backupFetch: vi.fn(async () => {}),
    recovery: vi.fn(async (action) => action === "restore" ? {
      status: "passed",
      recoveryTargetReached: true,
      restoreDatabase: "ai_phone_restore_drill_01",
      observedDataLossSeconds: 2,
    } : {
      status: "passed",
      isolatedTarget: true,
      writeIsolationVerified: true,
    }),
    databaseIdentity: vi.fn(async (service) => service === "ai-phone-writer" ? {
      database: "ai_phone_staging",
      inRecovery: false,
      serverAddress: "10.0.0.1",
      serverPort: 5432,
    } : {
      database: "ai_phone_restore_drill_01",
      inRecovery: false,
      serverAddress: "10.0.0.2",
      serverPort: 5433,
    }),
    logicalSha256: vi.fn(async () => "b".repeat(64)),
  };
}

async function step(input, name) {
  return runWalgBackupProviderStep({ ...input, step: name });
}

describe("runWalgBackupProviderStep", () => {
  it("proves immutable backup, WAL archive, isolated restore and logical checksum", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "walg-provider-"));
    const input = { root, config: config(root), runtime: runtime(),
      runId: "run-12345678" };
    const backup = await step(input, "create-base-backup");
    const archive = await step(input, "verify-archive");
    const restore = await step(input, "restore-off-host");
    const verified = await step(input, "verify-restore");
    expect(backup).toMatchObject({ offHost: true, immutable: true, retentionDays: 35 });
    expect(archive).toMatchObject({ unresolvedArchiveFailures: 0 });
    expect(restore).toMatchObject({ checksumVerified: true,
      restoreDatabase: "ai_phone_restore_drill_01" });
    expect(verified.sourceDataSha256).toBe("b".repeat(64));
    const state = path.join(root, config(root).stateDirectory, "run-12345678.json");
    expect(statSync(state).mode & 0o777).toBe(0o600);
  });

  it("reconciles a completed backup after the first process loses its response", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "walg-provider-"));
    const providerRuntime = runtime();
    providerRuntime.backupPush.mockRejectedValueOnce(new Error("connection lost"));
    providerRuntime.backupList
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "base_00000001", raw: {} }]);
    const input = { root, config: config(root), runtime: providerRuntime,
      runId: "run-12345678" };
    await expect(step(input, "create-base-backup")).rejects.toThrow("connection lost");
    const result = await step(input, "create-base-backup");
    expect(result.backupId).toBe("base_00000001");
    expect(providerRuntime.backupPush).toHaveBeenCalledTimes(1);
  });
});
