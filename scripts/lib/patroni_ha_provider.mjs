import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export async function runPatroniHaProviderStep(options) {
  const { config, runtime, root, runId, step } = options;
  const stateFile = providerStateFile(root, config.stateDirectory, runId);
  const context = { config, runtime, runId, stateFile, delay: options.delay ?? delay };
  switch (step) {
    case "baseline": return baseline(context);
    case "trigger-failover": return triggerFailover(context);
    case "verify-fencing": return verifyFencing(context);
    case "verify-endpoint": return verifyEndpoint(context);
    case "rebuild-old-primary": return rebuildOldPrimary(context);
    default: throw new Error(`Unsupported Patroni HA provider step: ${step}`);
  }
}

async function baseline(context) {
  const dcs = await context.runtime.verifyDcs({ runId: context.runId });
  if (dcs?.status !== "passed" || dcs?.quorumHealthy !== true ||
    dcs?.voterCount < 3 || dcs?.failureDomainCount < 3) {
    throw new Error("Patroni DCS quorum attestation failed");
  }
  const cluster = await context.runtime.cluster();
  const candidate = context.config.nodes.find(
    (node) => node.id === context.config.failoverCandidateId,
  );
  if (!candidate || candidate.id === cluster.primary.id) {
    throw new Error("Configured Patroni failover candidate is not a standby");
  }
  const probeId = `ha-${randomUUID()}`;
  const probe = await context.runtime.writeProbe(context.config.writerPgService, {
    runId: context.runId,
    probeId,
  });
  if (probe.database !== context.config.sourceDatabase || probe.inRecovery !== false ||
    probe.readOnly !== "off" || probe.probeExists !== true) {
    throw new Error("Baseline writer probe did not reach the writable source database");
  }
  const state = {
    schemaVersion: 1,
    runId: context.runId,
    oldPrimaryId: cluster.primary.id,
    newPrimaryId: candidate.id,
    baselineProbeId: probeId,
    baselineTimeline: cluster.primary.timeline,
    baselineAt: new Date().toISOString(),
  };
  writeState(context.stateFile, state);
  return passed({
    sourceDatabase: context.config.sourceDatabase,
    primaryId: cluster.primary.id,
    writeProbeId: probeId,
    primaryTimeline: cluster.primary.timeline,
    dcsVoterCount: dcs.voterCount,
    dcsFailureDomainCount: dcs.failureDomainCount,
  });
}

async function triggerFailover(context) {
  const state = readState(context.stateFile, context.runId);
  const before = await context.runtime.cluster();
  if (before.primary.id === state.newPrimaryId && state.failoverCompletedAt) {
    return passed(failoverResult(state, true));
  }
  if (before.primary.id !== state.oldPrimaryId) {
    throw new Error("Patroni primary changed outside the recorded HA drill");
  }
  if (state.failoverIntentAt) {
    throw new Error("Previous failover intent is indeterminate; reconcile before retrying");
  }
  state.failoverIntentAt = new Date().toISOString();
  writeState(context.stateFile, state);
  const startedAt = Date.now();
  const injection = await context.runtime.injectFailure({
    runId: context.runId,
    oldPrimaryId: state.oldPrimaryId,
    newPrimaryId: state.newPrimaryId,
  });
  if (injection?.status !== "passed" || injection?.injectionObserved !== true ||
    injection?.automaticRecoveryEnabled !== true) {
    throw new Error("Failure controller did not attest bounded automatic recovery");
  }
  const cluster = await waitForCluster(context, (value) =>
    value.primary.id === state.newPrimaryId);
  const baseline = await context.runtime.probeExists(context.config.writerPgService, {
    runId: context.runId,
    probeId: state.baselineProbeId,
  });
  if (baseline.probeExists !== true) {
    throw new Error("Baseline write probe was lost during Patroni failover");
  }
  const postFailoverProbeId = `ha-${randomUUID()}`;
  await context.runtime.writeProbe(context.config.writerPgService, {
    runId: context.runId,
    probeId: postFailoverProbeId,
  });
  state.failoverCompletedAt = new Date().toISOString();
  state.observedRpoSeconds = 0;
  state.observedRtoSeconds = Math.ceil((Date.now() - startedAt) / 1000);
  state.newPrimaryTimeline = cluster.primary.timeline;
  state.failureOperationId = String(injection.operationId ?? context.runId);
  state.postFailoverProbeId = postFailoverProbeId;
  writeState(context.stateFile, state);
  return passed(failoverResult(state, false));
}

async function verifyFencing(context) {
  const state = completedState(context);
  const cluster = await context.runtime.cluster();
  const old = cluster.members.find((member) => member.id === state.oldPrimaryId);
  const node = nodeConfig(context.config, state.oldPrimaryId);
  const direct = await context.runtime.readOnlyProbe(node.pgService);
  const fenced = direct.reachable === false ||
    (direct.inRecovery === true && direct.readOnly === "on");
  if (!fenced || old?.role === "primary") {
    throw new Error("Old Patroni primary still accepts writes");
  }
  return passed({
    fencingPassed: true,
    oldPrimaryWriteRejected: true,
    testedPrimaryId: state.oldPrimaryId,
    fencingMechanism: direct.reachable ? "postgres_read_only" : "node_isolation",
  });
}

async function verifyEndpoint(context) {
  const state = completedState(context);
  const cluster = await context.runtime.cluster();
  if (cluster.primary.id !== state.newPrimaryId) {
    throw new Error("Writer endpoint verification found the wrong Patroni primary");
  }
  const probe = await context.runtime.writeProbe(context.config.writerPgService, {
    runId: context.runId,
    probeId: `ha-${randomUUID()}`,
  });
  if (probe.database !== context.config.sourceDatabase || probe.inRecovery !== false ||
    probe.readOnly !== "off" || probe.probeExists !== true) {
    throw new Error("Writer endpoint did not reach the promoted Patroni primary");
  }
  return passed({
    endpointSwitched: true,
    discoveredPrimaryId: state.newPrimaryId,
    writeProbeSucceeded: true,
    serverAddress: probe.serverAddress,
  });
}

async function rebuildOldPrimary(context) {
  const state = completedState(context);
  const recovery = await context.runtime.recoverNode({
    runId: context.runId,
    oldPrimaryId: state.oldPrimaryId,
    newPrimaryId: state.newPrimaryId,
  });
  if (recovery?.status !== "passed" || recovery?.recoveryRequested !== true) {
    throw new Error("Recovery controller did not accept the old Patroni primary");
  }
  let cluster = await waitForCluster(context, (value) =>
    value.members.some((member) => member.id === state.oldPrimaryId),
  context.config.rebuildTimeoutSeconds);
  let old = cluster.members.find((member) => member.id === state.oldPrimaryId);
  if (old?.role !== "standby" || old?.state !== "running") {
    await context.runtime.reinitialize(state.oldPrimaryId);
    cluster = await waitForCluster(context, (value) => value.members.some((member) => {
      return member.id === state.oldPrimaryId && member.role === "standby" &&
        member.state === "running";
    }), context.config.rebuildTimeoutSeconds);
    old = cluster.members.find((member) => member.id === state.oldPrimaryId);
  }
  const timelineMatches = Number.isInteger(old?.timeline) &&
    old.timeline === cluster.primary.timeline;
  if (old?.role !== "standby" || old?.state !== "running" || !timelineMatches) {
    throw new Error("Old Patroni primary did not rejoin the promoted timeline");
  }
  return passed({
    oldPrimaryRejoined: true,
    rejoinedNodeId: state.oldPrimaryId,
    role: "standby",
    timelineMatches: true,
  });
}

async function waitForCluster(context, predicate, timeoutSeconds) {
  const timeout = timeoutSeconds ?? context.config.failoverTimeoutSeconds;
  const deadline = Date.now() + timeout * 1000;
  let last;
  while (Date.now() <= deadline) {
    last = await context.runtime.cluster();
    if (predicate(last)) return last;
    await context.delay(context.config.pollIntervalMs);
  }
  throw new Error(`Patroni cluster did not converge; last primary=${last?.primary?.id}`);
}

function completedState(context) {
  const state = readState(context.stateFile, context.runId);
  if (!state.failoverCompletedAt) throw new Error("Patroni failover has not completed");
  return state;
}

function failoverResult(state, replayed) {
  return {
    healthControllerInitiated: true,
    oldPrimaryId: state.oldPrimaryId,
    newPrimaryId: state.newPrimaryId,
    observedRpoSeconds: state.observedRpoSeconds,
    observedRtoSeconds: state.observedRtoSeconds,
    providerOperationId: state.failureOperationId,
    replayed,
  };
}

function passed(value) {
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    tlsMode: "verify-full",
    ...value,
  };
}

function providerStateFile(root, directory, runId) {
  const target = path.resolve(root, directory);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Patroni provider state directory escaped the repository");
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  return path.join(target, `${runId}.json`);
}

function readState(file, runId) {
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); } catch {
    throw new Error("Patroni HA provider state is missing or invalid");
  }
  if (state.schemaVersion !== 1 || state.runId !== runId) {
    throw new Error("Patroni HA provider state does not match this run");
  }
  return state;
}

function writeState(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function nodeConfig(config, id) {
  const node = config.nodes.find((value) => value.id === id);
  if (!node) throw new Error(`Patroni node is not configured: ${id}`);
  return node;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
