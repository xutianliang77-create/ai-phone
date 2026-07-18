import {
  parseSingleJson,
  runProviderProcess,
  selectedEnvironment,
  verifyExecutable,
} from "./provider_executable.mjs";

export class PatroniHaProviderRuntime {
  constructor(config, options = {}) {
    this.config = config;
    this.run = options.run ?? runProviderProcess;
  }

  verifyExecutables() {
    verifyExecutable(this.config.patronictl.file, this.config.patronictl.sha256);
    verifyExecutable(this.config.psql.file, this.config.psql.sha256);
    verifyExecutable(
      this.config.failureController.file,
      this.config.failureController.sha256,
    );
    verifyExecutable(
      this.config.recoveryController.file,
      this.config.recoveryController.sha256,
    );
    verifyExecutable(this.config.dcsController.file, this.config.dcsController.sha256);
  }

  async cluster() {
    const result = await this.run(this.config.patronictl.file, [
      "-c", this.config.patroniConfigFile,
      "list", this.config.clusterName,
      "--format", "json",
    ], {
      timeoutMs: 30_000,
      env: selectedEnvironment(this.config.patroniEnvironmentKeys),
    });
    const rows = parseSingleJson(result.stdout, "patronictl list");
    if (!Array.isArray(rows)) throw new Error("patronictl list must return an array");
    const members = rows.map(normalizeMember);
    const primaries = members.filter((member) => member.role === "primary");
    if (primaries.length !== 1) throw new Error("Patroni cluster must have one primary");
    return { members, primary: primaries[0] };
  }

  async writeProbe(service, input) {
    const sql = [
      `INSERT INTO ${this.config.probeTable} (run_id, probe_id, created_at)`,
      `VALUES (${literal(input.runId)}, ${literal(input.probeId)}, clock_timestamp())`,
      "ON CONFLICT (run_id, probe_id) DO NOTHING;",
      "SELECT json_build_object(",
      "'database', current_database(),",
      "'inRecovery', pg_is_in_recovery(),",
      "'readOnly', current_setting('transaction_read_only'),",
      "'serverAddress', COALESCE(inet_server_addr()::text, 'local'),",
      "'walLsn', pg_current_wal_lsn()::text,",
      `'probeExists', EXISTS (SELECT 1 FROM ${this.config.probeTable}`,
      ` WHERE run_id = ${literal(input.runId)} AND probe_id = ${literal(input.probeId)}));`,
    ].join(" ");
    return this.psqlJson(service, sql);
  }

  async probeExists(service, input) {
    return this.psqlJson(service, [
      "SELECT json_build_object('probeExists', EXISTS (SELECT 1 FROM",
      this.config.probeTable,
      `WHERE run_id = ${literal(input.runId)} AND probe_id = ${literal(input.probeId)}));`,
    ].join(" "));
  }

  async readOnlyProbe(service) {
    try {
      const value = await this.psqlJson(service, [
        "SELECT json_build_object(",
        "'inRecovery', pg_is_in_recovery(),",
        "'readOnly', current_setting('transaction_read_only'),",
        "'serverAddress', COALESCE(inet_server_addr()::text, 'local'));",
      ].join(" "));
      return { reachable: true, ...value };
    } catch {
      return { reachable: false };
    }
  }

  async injectFailure(input) {
    return this.controller(this.config.failureController, input, 120_000);
  }

  async verifyDcs(input) {
    return this.controller(this.config.dcsController, input, 30_000);
  }

  async recoverNode(input) {
    return this.controller(this.config.recoveryController, input, 300_000);
  }

  async reinitialize(memberId) {
    await this.run(this.config.patronictl.file, [
      "-c", this.config.patroniConfigFile,
      "reinit", this.config.clusterName, memberId,
      "--force", "--wait",
    ], {
      timeoutMs: this.config.rebuildTimeoutSeconds * 1000,
      env: selectedEnvironment(this.config.patroniEnvironmentKeys),
    });
  }

  async psqlJson(service, sql) {
    const result = await this.run(this.config.psql.file, [
      "--no-psqlrc", "--tuples-only", "--no-align",
      "--set", "ON_ERROR_STOP=1",
      "--dbname", `service=${service}`,
      "--command", sql,
    ], {
      timeoutMs: 30_000,
      env: selectedEnvironment(this.config.databaseEnvironmentKeys),
    });
    const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
    return parseSingleJson(line ?? "", "psql probe");
  }

  async controller(controller, input, timeoutMs) {
    const args = controller.args.map((value) => substitute(value, input));
    const result = await this.run(controller.file, args, {
      timeoutMs,
      env: selectedEnvironment(controller.environmentKeys, {
        POSTGRES_RESILIENCE_RUN_ID: input.runId ?? "",
        POSTGRES_RESILIENCE_OLD_PRIMARY_ID: input.oldPrimaryId ?? "",
        POSTGRES_RESILIENCE_NEW_PRIMARY_ID: input.newPrimaryId ?? "",
      }),
    });
    return parseSingleJson(result.stdout, "HA controller");
  }
}

function normalizeMember(row) {
  const id = row.Member ?? row.member ?? row.Name ?? row.name;
  const role = String(row.Role ?? row.role ?? "").toLowerCase();
  return {
    id,
    role: /leader|primary/.test(role) ? "primary" :
      /replica|standby/.test(role) ? "standby" : role,
    state: String(row.State ?? row.state ?? "").toLowerCase(),
    timeline: Number(row.TL ?? row.timeline ?? row.Timeline),
  };
}

function substitute(value, input) {
  return value
    .replaceAll("{runId}", input.runId)
    .replaceAll("{oldPrimaryId}", input.oldPrimaryId)
    .replaceAll("{newPrimaryId}", input.newPrimaryId);
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
