import { randomUUID } from "node:crypto";
import { isEnterprisePostgresDrBinding } from
  "./enterprise_postgres_dr_evidence.mjs";
import { postgresResilienceStepIdentity } from
  "./postgres_resilience_attestation.mjs";

export async function runPostgresResilienceDrill(options) {
  const { config, runner } = options;
  const runId = options.runId ?? `pg-resilience-${randomUUID()}`;
  const enterpriseBinding = options.enterpriseBinding;
  if (!isEnterprisePostgresDrBinding(enterpriseBinding)) {
    throw new Error("Enterprise PostgreSQL DR binding is required");
  }
  if (enterpriseBinding.topologySha256 !== options.topologySha256 ||
    !sha256(options.capacityResultSha256)) {
    throw new Error("Enterprise PostgreSQL DR input hashes are invalid");
  }
  const events = [];
  const emit = (event) => {
    const value = { at: new Date().toISOString(), runId, ...event };
    events.push(value);
    options.onEvent?.(value);
  };
  assertAcknowledged(config, options.environment ?? process.env);
  const context = { config, runner, runId, signal: options.signal, emit };
  emit({ type: "drill.started", haMode: config.ha.mode, walMode: config.wal.mode });

  try {
    const baseline = await runStep(context, "ha", "baseline", config.ha.commands.baseline);
    const baseBackup = await runStep(
      context,
      "wal",
      "createBaseBackup",
      config.wal.commands.createBaseBackup,
    );
    const archive = await runStep(
      context,
      "wal",
      "verifyArchive",
      config.wal.commands.verifyArchive,
    );
    const failover = await runStep(
      context,
      "ha",
      "triggerFailover",
      config.ha.commands.triggerFailover,
    );
    const fencing = await runStep(
      context,
      "ha",
      "verifyFencing",
      config.ha.commands.verifyFencing,
    );
    const endpoint = await runStep(
      context,
      "ha",
      "verifyEndpoint",
      config.ha.commands.verifyEndpoint,
    );
    const rebuild = await runStep(
      context,
      "ha",
      "rebuildOldPrimary",
      config.ha.commands.rebuildOldPrimary,
    );
    const restore = await runStep(
      context,
      "wal",
      "restoreOffHost",
      config.wal.commands.restoreOffHost,
    );
    const restoreVerification = await runStep(
      context,
      "wal",
      "verifyRestore",
      config.wal.commands.verifyRestore,
    );
    const steps = {
      baseline,
      baseBackup,
      archive,
      failover,
      fencing,
      endpoint,
      rebuild,
      restore,
      restoreVerification,
    };
    const issues = validateDrill(config, steps, runId, enterpriseBinding);
    const result = buildResult({
      config,
      runId,
      topologySha256: options.topologySha256,
      capacityResultSha256: options.capacityResultSha256,
      enterpriseBinding,
      steps,
      issues,
    });
    emit({ type: "drill.completed", status: result.status, issues });
    return { runId, result, steps, issues, events };
  } finally {
    await runner.shutdown?.().catch(() => undefined);
  }
}

async function runStep(context, group, name, command) {
  throwIfAborted(context.signal);
  context.emit({ type: "drill.step.started", group, step: name });
  const value = await context.runner.execute(command, {
    label: `${group}-${name}`,
    timeoutMs: command.timeoutSeconds * 1000,
    signal: context.signal,
    env: {
      POSTGRES_RESILIENCE_RUN_ID: context.runId,
      POSTGRES_RESILIENCE_GROUP: group,
      POSTGRES_RESILIENCE_STEP: name,
      POSTGRES_RESILIENCE_SOURCE_DATABASE: context.config.safety.sourceDatabase,
      POSTGRES_RESILIENCE_RESTORE_DATABASE: context.config.safety.restoreDatabase,
      POSTGRES_RESILIENCE_TLS_MODE: context.config.safety.tlsMode,
      POSTGRES_RESILIENCE_HA_MODE: context.config.ha.mode,
      POSTGRES_RESILIENCE_WAL_MODE: context.config.wal.mode,
      POSTGRES_RESILIENCE_MAX_RPO_SECONDS: String(
        context.config.objectives.maxRpoSeconds,
      ),
      POSTGRES_RESILIENCE_MAX_RTO_SECONDS: String(
        context.config.objectives.maxRtoSeconds,
      ),
    },
  });
  context.emit({
    type: "drill.step.completed",
    group,
    step: name,
    status: value?.status ?? "invalid",
  });
  return value;
}

function validateDrill(config, steps, runId, enterpriseBinding) {
  const issues = [];
  for (const [name, value] of Object.entries(steps)) {
    const [group, step] = postgresResilienceStepIdentity(name);
    if (value?.schemaVersion !== 1 || value?.status !== "passed" ||
      value?.environment !== "staging" ||
      value?.tlsMode !== "verify-full" || value?.runId !== runId ||
      value?.group !== group || value?.step !== step) {
      issues.push(`${name} did not return a valid staging verify-full attestation`);
    }
  }
  const baseline = steps.baseline;
  if (!validId(baseline?.primaryId) || baseline?.sourceDatabase !== "ai_phone_staging" ||
    !validId(baseline?.writeProbeId)) {
    issues.push("Baseline primary and write probe are invalid");
  }
  validateFailover(config, steps, issues, enterpriseBinding);
  validateWal(config, steps, issues);
  return issues;
}

function validateFailover(config, steps, issues, enterpriseBinding) {
  const failover = steps.failover;
  if (failover?.healthControllerInitiated !== true ||
    failover?.oldPrimaryId !== steps.baseline?.primaryId ||
    !validId(failover?.newPrimaryId) ||
    failover?.newPrimaryId === failover?.oldPrimaryId ||
    !integer(failover?.oldPrimaryTimeline, 1) ||
    !integer(failover?.newPrimaryTimeline, failover.oldPrimaryTimeline + 1) ||
    !integer(failover?.promotionGeneration, 1) ||
    !within(failover?.observedRpoSeconds, config.objectives.maxRpoSeconds) ||
    !within(failover?.observedRtoSeconds, config.objectives.maxRtoSeconds)) {
    issues.push("Automatic failover identity or RPO/RTO attestation failed");
  }
  if (steps.fencing?.fencingPassed !== true ||
    steps.fencing?.oldPrimaryWriteRejected !== true ||
    steps.fencing?.testedPrimaryId !== failover?.oldPrimaryId ||
    steps.fencing?.writeRejectionSqlState !== "25006" ||
    steps.fencing?.oldRouteEpochWriteRejected !== true ||
    steps.fencing?.oldWorkerGenerationRejected !== true) {
    issues.push("Old-primary fencing was not proven");
  }
  if (steps.endpoint?.endpointSwitched !== true ||
    steps.endpoint?.discoveredPrimaryId !== failover?.newPrimaryId ||
    steps.endpoint?.writeProbeSucceeded !== true ||
    steps.endpoint?.databaseSystemIdentifier !==
      enterpriseBinding.database.systemIdentifier) {
    issues.push("Service discovery did not switch to the new primary");
  }
  if (steps.rebuild?.oldPrimaryRejoined !== true ||
    steps.rebuild?.rejoinedNodeId !== failover?.oldPrimaryId ||
    steps.rebuild?.role !== "standby" || steps.rebuild?.timelineMatches !== true ||
    steps.rebuild?.acceptsWrites !== false) {
    issues.push("Old primary was not rebuilt and rejoined as a standby");
  }
}

function validateWal(config, steps, issues) {
  const backup = steps.baseBackup;
  if (backup?.offHost !== true || backup?.encryptedInTransit !== true ||
    backup?.encryptedAtRest !== true || backup?.immutable !== true ||
    backup?.retentionDays < config.wal.retentionDays ||
    !["compliance_lock", "provider_retention_lock"].includes(
      backup?.immutabilityMode,
    ) || config.ha.nodes.some((node) =>
      node.failureDomain === backup?.failureDomain) ||
    !validId(backup?.failureDomain) || !validId(backup?.backupId) ||
    !sha256(backup?.checksumSha256)) {
    issues.push("Off-host encrypted immutable base backup was not proven");
  }
  const archive = steps.archive;
  if (archive?.unresolvedArchiveFailures !== 0 ||
    !within(archive?.maxObservedArchiveLagSeconds, config.objectives.maxRpoSeconds) ||
    !validId(archive?.lastArchivedWal) || !boundedString(archive?.objectVersionId)) {
    issues.push("WAL archive lag, failures, or object version attestation failed");
  }
  const restore = steps.restore;
  if (restore?.source !== "off_host_object_storage" ||
    restore?.backupId !== backup?.backupId || restore?.checksumVerified !== true ||
    restore?.recoveryTargetReached !== true ||
    restore?.restoreDatabase !== config.safety.restoreDatabase ||
    !timestamp(restore?.recoveryTargetTime) ||
    !validId(restore?.targetMarkerId) ||
    !within(restore?.observedDataLossSeconds, config.objectives.maxRpoSeconds)) {
    issues.push("Off-host PITR restore did not meet checksum, target, or RPO requirements");
  }
  const verified = steps.restoreVerification;
  if (verified?.isolatedTarget !== true || verified?.writeIsolationVerified !== true ||
    verified?.restoreDatabase !== config.safety.restoreDatabase ||
    verified?.targetMarkerId !== restore?.targetMarkerId ||
    verified?.preTargetMarkerPresent !== true ||
    verified?.postTargetMarkerAbsent !== true ||
    !sha256(verified?.targetDataSha256) ||
    verified?.targetDataSha256 !== verified?.restoredDataSha256 ||
    !sha256(verified?.targetCriticalManifestSha256) ||
    verified?.targetCriticalManifestSha256 !==
      verified?.restoredCriticalManifestSha256) {
    issues.push("Restored data checksum or isolation verification failed");
  }
}

function buildResult(input) {
  const { config, steps } = input;
  const passed = input.issues.length === 0;
  return {
    schemaVersion: 2,
    status: passed ? "passed" : "failed",
    environment: "staging",
    runId: input.runId,
    topologySha256: input.topologySha256,
    capacityResultSha256: input.capacityResultSha256,
    enterprise: input.enterpriseBinding,
    completedAt: new Date().toISOString(),
    objectives: config.objectives,
    ha: {
      mode: config.ha.mode,
      nodes: config.ha.nodes,
      dcsVoters: config.ha.dcsVoters ?? 0,
      dcsFailureDomains: config.ha.dcsFailureDomains ?? [],
      automaticFailover: {
        status: passed ? "passed" : "failed",
        healthControllerInitiated: steps.failover.healthControllerInitiated,
        fencingPassed: steps.fencing.fencingPassed,
        oldPrimaryWriteRejected: steps.fencing.oldPrimaryWriteRejected,
        writeRejectionSqlState: steps.fencing.writeRejectionSqlState,
        oldRouteEpochWriteRejected: steps.fencing.oldRouteEpochWriteRejected,
        oldWorkerGenerationRejected: steps.fencing.oldWorkerGenerationRejected,
        endpointSwitched: steps.endpoint.endpointSwitched,
        databaseSystemIdentifier: steps.endpoint.databaseSystemIdentifier,
        oldPrimaryRejoined: steps.rebuild.oldPrimaryRejoined,
        rejoinedPrimaryAcceptsWrites: steps.rebuild.acceptsWrites,
        oldPrimaryTimeline: steps.failover.oldPrimaryTimeline,
        newPrimaryTimeline: steps.failover.newPrimaryTimeline,
        promotionGeneration: steps.failover.promotionGeneration,
        observedRpoSeconds: steps.failover.observedRpoSeconds,
        observedRtoSeconds: steps.failover.observedRtoSeconds,
      },
    },
    wal: {
      mode: config.wal.mode,
      targetClass: config.wal.targetClass,
      offHost: steps.baseBackup.offHost,
      encryptedInTransit: steps.baseBackup.encryptedInTransit,
      encryptedAtRest: steps.baseBackup.encryptedAtRest,
      immutable: steps.baseBackup.immutable,
      immutabilityMode: steps.baseBackup.immutabilityMode,
      failureDomain: steps.baseBackup.failureDomain,
      retentionDays: steps.baseBackup.retentionDays,
      unresolvedArchiveFailures: steps.archive.unresolvedArchiveFailures,
      maxObservedArchiveLagSeconds: steps.archive.maxObservedArchiveLagSeconds,
      restoreDrill: {
        status: passed ? "passed" : "failed",
        source: steps.restore.source,
        checksumVerified: steps.restore.checksumVerified,
        recoveryTargetReached: steps.restore.recoveryTargetReached,
        recoveryTargetTime: steps.restore.recoveryTargetTime,
        targetMarkerId: steps.restore.targetMarkerId,
        preTargetMarkerPresent: steps.restoreVerification.preTargetMarkerPresent,
        postTargetMarkerAbsent: steps.restoreVerification.postTargetMarkerAbsent,
        targetDataSha256: steps.restoreVerification.targetDataSha256,
        restoredDataSha256: steps.restoreVerification.restoredDataSha256,
        targetCriticalManifestSha256:
          steps.restoreVerification.targetCriticalManifestSha256,
        restoredCriticalManifestSha256:
          steps.restoreVerification.restoredCriticalManifestSha256,
        observedDataLossSeconds: steps.restore.observedDataLossSeconds,
      },
    },
    evidence: [],
  };
}

function assertAcknowledged(config, environment) {
  if (environment.POSTGRES_RESILIENCE_STAGING_ACK !== config.safety.acknowledgement) {
    throw new Error("POSTGRES_RESILIENCE_STAGING_ACK does not match the drill contract");
  }
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{2,256}$/.test(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function boundedString(value) {
  return typeof value === "string" && value.length >= 2 && value.length <= 512;
}

function within(value, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function integer(value, minimum) {
  return Number.isInteger(value) && value >= minimum;
}

function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error("Resilience drill aborted");
}
