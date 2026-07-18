import {
  hashProviderProcessOutput,
  parseSingleJson,
  runProviderProcess,
  selectedEnvironment,
  verifyExecutable,
} from "./provider_executable.mjs";

export class WalgBackupProviderRuntime {
  constructor(config, options = {}) {
    this.config = config;
    this.run = options.run ?? runProviderProcess;
    this.hashRun = options.hashRun ?? hashProviderProcessOutput;
  }

  verifyExecutables() {
    for (const value of [this.config.walG, this.config.psql, this.config.pgDump,
      this.config.storageController, this.config.recoveryController]) {
      verifyExecutable(value.file, value.sha256);
    }
  }

  async backupList() {
    const result = await this.walG(["backup-list", "--json"], 60_000);
    const value = parseSingleJson(result.stdout, "wal-g backup-list");
    const rows = Array.isArray(value) ? value : value?.backups;
    if (!Array.isArray(rows)) throw new Error("wal-g backup-list must return backups");
    return rows.map((row) => ({ id: backupId(row), raw: row }));
  }

  backupPush() {
    return this.walG(["backup-push", this.config.pgDataDirectory],
      this.config.backupTimeoutSeconds * 1000);
  }

  async walShow() {
    const result = await this.walG(["wal-show", "--json"], 60_000);
    return parseSingleJson(result.stdout, "wal-g wal-show");
  }

  backupFetch(backupId) {
    return this.walG(["backup-fetch", this.config.restoreDataDirectory, backupId],
      this.config.restoreTimeoutSeconds * 1000);
  }

  async switchWal() {
    return this.psqlJson(this.config.writerPgService, [
      "SELECT json_build_object('lastArchivedWal',",
      "pg_walfile_name(pg_switch_wal()), 'switchedAt', clock_timestamp());",
    ].join(" "));
  }

  async databaseIdentity(service) {
    return this.psqlJson(service, [
      "SELECT json_build_object('database', current_database(),",
      "'inRecovery', pg_is_in_recovery(),",
      "'serverAddress', COALESCE(inet_server_addr()::text, 'local'),",
      "'serverPort', inet_server_port());",
    ].join(" "));
  }

  async logicalSha256(service) {
    const result = await this.hashRun(this.config.pgDump.file, [
      "--dbname", `service=${service}`,
      "--format=plain", "--schema=public", "--no-owner", "--no-privileges",
      "--no-comments", "--no-publications", "--no-subscriptions",
    ], {
      timeoutMs: this.config.verifyTimeoutSeconds * 1000,
      env: selectedEnvironment(this.config.databaseEnvironmentKeys),
      normalizeLine: normalizePgDumpLine,
    });
    return result.stdoutSha256;
  }

  storageAttestation(action, input) {
    return this.controller(this.config.storageController, action, input);
  }

  recovery(action, input) {
    return this.controller(this.config.recoveryController, action, input);
  }

  walG(args, timeoutMs) {
    return this.run(this.config.walG.file, args, {
      timeoutMs,
      env: selectedEnvironment(this.config.walGEnvironmentKeys),
    });
  }

  async psqlJson(service, sql) {
    const result = await this.run(this.config.psql.file, [
      "--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
      "--dbname", `service=${service}`, "--command", sql,
    ], {
      timeoutMs: this.config.verifyTimeoutSeconds * 1000,
      env: selectedEnvironment(this.config.databaseEnvironmentKeys),
    });
    const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
    return parseSingleJson(line ?? "", "psql WAL-G probe");
  }

  async controller(controller, action, input) {
    const args = controller.args.map((value) => substitute(value, { action, ...input }));
    const result = await this.run(controller.file, args, {
      timeoutMs: this.config.verifyTimeoutSeconds * 1000,
      env: selectedEnvironment(controller.environmentKeys, {
        POSTGRES_RESILIENCE_PROVIDER_ACTION: action,
        POSTGRES_RESILIENCE_RUN_ID: input.runId,
        POSTGRES_RESILIENCE_BACKUP_ID: input.backupId ?? "",
        POSTGRES_RESILIENCE_TARGET_WAL: input.targetWal ?? "",
        POSTGRES_RESILIENCE_RESTORE_DATABASE: this.config.restoreDatabase,
        POSTGRES_RESILIENCE_RESTORE_DATA_DIRECTORY: this.config.restoreDataDirectory,
      }),
    });
    return parseSingleJson(result.stdout, `${action} controller`);
  }
}

function normalizePgDumpLine(line) {
  if (/^--/.test(line) || /^\\(?:un)?restrict\b/.test(line)) return null;
  return line;
}

function backupId(row) {
  const value = row?.backup_name ?? row?.backupName ?? row?.name;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:+-]{2,256}$/.test(value)) {
    throw new Error("wal-g backup-list returned an invalid backup id");
  }
  return value;
}

function substitute(value, input) {
  let result = value;
  for (const [key, item] of Object.entries(input)) {
    result = result.replaceAll(`{${key}}`, String(item ?? ""));
  }
  return result;
}
