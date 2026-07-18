import { randomUUID } from "node:crypto";
import {
  buildPlatformCapacityResult,
  summarizeMixedLoadPhase,
  validateMixedLoadAttestation,
} from "./platform_mixed_load_result.mjs";

export async function runPlatformMixedLoad(options) {
  const { config, driver } = options;
  const signal = options.signal;
  const runId = options.runId ?? `capacity-${compactTimestamp()}-${randomUUID().slice(0, 8)}`;
  const events = [];
  const phases = [];
  const emit = (event) => {
    const value = { at: new Date().toISOString(), runId, ...event };
    events.push(value);
    options.onEvent?.(value);
  };

  assertAcknowledged(config, options.environment ?? process.env);
  emit({ type: "run.started", mode: config.mode });
  try {
    for (const stage of config.stages) {
      phases.push(await runPhase({
        runId,
        config,
        driver,
        signal,
        emit,
        name: `capacity-${stage.concurrentSessions}`,
        type: "capacity",
        ...stage,
      }));
    }
    phases.push(await runPhase({
      runId,
      config,
      driver,
      signal,
      emit,
      name: "soak",
      type: "soak",
      ...config.soak,
      rampUpSeconds: config.soak.rampUpSeconds ?? 0,
    }));
    phases.push(await runPhase({
      runId,
      config,
      driver,
      signal,
      emit,
      name: "admission",
      type: "admission",
      ...config.admission,
      rampUpSeconds: config.admission.rampUpSeconds ?? 0,
    }));
  } finally {
    await driver.shutdown?.().catch(() => undefined);
  }

  const result = buildPlatformCapacityResult({
    runId,
    config,
    phases,
    topologySha256: options.topologySha256,
    evidence: options.evidence ?? [],
  });
  emit({ type: "run.completed", status: result.status });
  return { runId, result, phases, events };
}

async function runPhase(context) {
  throwIfAborted(context.signal);
  const assignments = assignScenarios(
    context.config.scenarios,
    context.concurrentSessions,
  );
  const phaseDurationMs = context.durationMinutes * 60_000;
  const results = [];
  const failures = [];
  const pending = new Set();
  const systemRun = sampleSystemAtPeak(context, phaseDurationMs).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  const failureRuns = failuresForPhase(context.config, context.name).map((failure) =>
    runFailureInjection({ ...context, failure, phaseDurationMs })
  );
  context.emit({
    type: "phase.started",
    phase: context.name,
    concurrentSessions: context.concurrentSessions,
    durationMinutes: context.durationMinutes,
  });

  for (let index = 0; index < assignments.length; index += 1) {
    throwIfAborted(context.signal);
    while (pending.size >= context.config.safety.maxPendingStarts) {
      await Promise.race(pending);
    }
    const scenario = assignments[index];
    const sessionId = `${context.name}-${String(index + 1).padStart(3, "0")}`;
    const promise = runSession({
      ...context,
      phaseDurationMs,
      scenario,
      sessionId,
    }).then((value) => results.push(value), (error) => {
      failures.push({ sessionId, message: errorMessage(error) });
    }).finally(() => pending.delete(promise));
    pending.add(promise);
    const rampDelay = rampDelayMs(context.rampUpSeconds, assignments.length);
    if (rampDelay > 0 && index + 1 < assignments.length) {
      await abortableDelay(rampDelay, context.signal);
    }
  }
  await Promise.allSettled([...pending]);
  const injected = await Promise.all(failureRuns);
  const sampled = await systemRun;
  if (sampled.error) throw sampled.error;
  const system = sampled.value;
  const summary = summarizeMixedLoadPhase(context, results, failures, injected, system);
  context.emit({
    type: "phase.completed",
    phase: context.name,
    status: summary.status,
    completed: summary.completedSessions,
    rejected: summary.rejectedSessions,
  });
  return summary;
}

async function sampleSystemAtPeak(context, phaseDurationMs) {
  const delayMs = context.rampUpSeconds * 1000 +
    context.config.safety.systemSampleDelaySeconds * 1000;
  if (delayMs >= phaseDurationMs) {
    throw new Error(`${context.name} system sample is scheduled after phase end`);
  }
  await abortableDelay(delayMs, context.signal);
  return context.driver.sampleSystem({
    runId: context.runId,
    phase: context.name,
    targetConcurrency: context.concurrentSessions,
    signal: context.signal,
  });
}

async function runSession(context) {
  context.emit({
    type: "session.started",
    phase: context.name,
    sessionId: context.sessionId,
    scenario: context.scenario.name,
  });
  const attestation = await context.driver.runSession({
    runId: context.runId,
    phase: context.name,
    phaseType: context.type,
    sessionId: context.sessionId,
    scenario: context.scenario,
    targetConcurrency: context.concurrentSessions,
    durationMs: context.phaseDurationMs,
    apiBaseUrl: context.config.safety.apiBaseUrl,
    allowedApiHosts: context.config.safety.allowedApiHosts,
    environment: context.config.environment,
    mode: context.config.mode,
    signal: context.signal,
  });
  const issues = validateMixedLoadAttestation(attestation, context);
  context.emit({
    type: "session.completed",
    phase: context.name,
    sessionId: context.sessionId,
    status: issues.length === 0 ? attestation.status : "failed",
    issues,
  });
  return { sessionId: context.sessionId, scenario: context.scenario.name, attestation, issues };
}

async function runFailureInjection(context) {
  if (context.failure.atSeconds * 1000 > context.phaseDurationMs) {
    return failureResult(context.failure.name, "injection scheduled after phase end");
  }
  try {
    await abortableDelay(context.failure.atSeconds * 1000, context.signal);
    context.emit({
      type: "failure_injection.started",
      phase: context.name,
      failure: context.failure.name,
    });
    const value = await context.driver.injectFailure({
      runId: context.runId,
      phase: context.name,
      failure: context.failure,
      targetConcurrency: context.concurrentSessions,
      signal: context.signal,
    });
    const issues = validateFailureAttestation(value, context);
    const passed = issues.length === 0;
    context.emit({
      type: "failure_injection.completed",
      phase: context.name,
      failure: context.failure.name,
      status: passed ? "passed" : "failed",
    });
    return passed ? { ...value, name: context.failure.name } :
      failureResult(context.failure.name, issues.join("; "));
  } catch (error) {
    return failureResult(context.failure.name, errorMessage(error));
  }
}

function validateFailureAttestation(value, context) {
  const issues = [];
  if (value?.schemaVersion !== 1) issues.push("invalid failure schemaVersion");
  if (value?.status !== "passed" || value?.recovered !== true) {
    issues.push("failure did not recover");
  }
  const seconds = Number(value?.observedRecoverySeconds);
  if (!Number.isFinite(seconds) || seconds < 0 ||
    seconds > context.failure.recoveryTimeoutSeconds) {
    issues.push("failure recovery exceeded its bound");
  }
  if (value?.failureName !== context.failure.name ||
    value?.target !== context.failure.target || value?.fault !== context.failure.fault) {
    issues.push("failure attestation binding mismatch");
  }
  if (context.config.mode === "real") {
    if (value?.environment !== "staging" || value?.realProviderTraffic !== true) {
      issues.push("failure attestation is not real staging");
    }
    if (value?.injectionObserved !== true || !nonEmptyStrings(value?.providerEvidence) ||
      !nonEmptyStrings(value?.recoveryEvidence)) {
      issues.push("failure evidence is incomplete");
    }
    if (value?.providerSideEffectDuplicates !== 0) {
      issues.push("failure controller replay duplicated a side effect");
    }
  }
  return issues;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 64 &&
    value.every((item) => typeof item === "string" && item.length > 0 &&
      item.length <= 512);
}

function assignScenarios(scenarios, count) {
  const weighted = scenarios.flatMap((scenario) =>
    Array.from({ length: scenario.weight }, () => scenario)
  );
  return Array.from({ length: count }, (_, index) => {
    const bucket = Math.min(
      weighted.length - 1,
      Math.floor((index + 0.5) * weighted.length / count),
    );
    return weighted[bucket];
  });
}

function failuresForPhase(config, phase) {
  return config.failureInjections.filter((failure) => failure.phase === phase);
}

function rampDelayMs(seconds, sessions) {
  return sessions > 1 ? Math.floor(seconds * 1000 / (sessions - 1)) : 0;
}

function assertAcknowledged(config, environment) {
  if (config.mode !== "real") return;
  if (environment.MIXED_LOAD_STAGING_ACK !== config.safety.acknowledgement) {
    throw new Error("MIXED_LOAD_STAGING_ACK does not match the staging safety contract");
  }
  const needsPhone = config.scenarios.some((scenario) =>
    scenario.trafficKinds.includes("sip") || scenario.trafficKinds.includes("agent")
  );
  if (needsPhone && !validPhoneAllowlist(environment.MIXED_LOAD_PSTN_ALLOWLIST)) {
    throw new Error("MIXED_LOAD_PSTN_ALLOWLIST must contain explicit E.164 staging numbers");
  }
}

function validPhoneAllowlist(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return value.split(",").every((phone) => /^\+[1-9]\d{7,14}$/.test(phone.trim()));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error("Mixed-load run aborted");
}

function abortableDelay(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", aborted, { once: true });
    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Mixed-load run aborted"));
    }
  });
}

function failureResult(name, message) {
  return { name, status: "failed", recovered: false, message };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}
