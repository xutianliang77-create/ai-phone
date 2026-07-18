import { BoundedJsonCommandRunner } from "./bounded_json_command_runner.mjs";

export class PlatformMixedLoadCommandDriver {
  constructor(options) {
    this.config = options.config;
    this.runner = new BoundedJsonCommandRunner({
      root: options.root,
      outputDirectory: options.outputDirectory,
      gracefulDrainSeconds: options.config.safety.gracefulDrainSeconds,
    });
  }

  runSession(context) {
    const timeoutMs = context.durationMs +
      this.config.safety.gracefulDrainSeconds * 1000;
    return this.runner.execute(context.scenario.command, {
      label: `${context.phase}-${context.sessionId}`,
      timeoutMs,
      signal: context.signal,
      env: sessionEnvironment(context),
    });
  }

  injectFailure(context) {
    return this.runner.execute(context.failure.command, {
      label: `failure-${context.phase}-${context.failure.name}`,
      timeoutMs: context.failure.recoveryTimeoutSeconds * 1000,
      signal: context.signal,
      env: {
        PLATFORM_LOAD_RUN_ID: context.runId,
        PLATFORM_LOAD_PHASE: context.phase,
        PLATFORM_LOAD_FAILURE: context.failure.name,
        PLATFORM_LOAD_TARGET_CONCURRENCY: String(context.targetConcurrency),
        PLATFORM_LOAD_RECOVERY_TIMEOUT_SECONDS: String(
          context.failure.recoveryTimeoutSeconds,
        ),
      },
    });
  }

  sampleSystem(context) {
    return this.runner.execute(this.config.systemProbe, {
      label: `system-${context.phase}`,
      timeoutMs: 60_000,
      signal: context.signal,
      env: {
        PLATFORM_LOAD_RUN_ID: context.runId,
        PLATFORM_LOAD_PHASE: context.phase,
        PLATFORM_LOAD_TARGET_CONCURRENCY: String(context.targetConcurrency),
      },
    });
  }

  async shutdown() {
    await this.runner.shutdown();
  }

  execute(command, options) {
    return this.runner.execute(command, options);
  }
}

function sessionEnvironment(context) {
  return {
    PLATFORM_LOAD_API_BASE_URL: context.apiBaseUrl,
    PLATFORM_LOAD_RUN_ID: context.runId,
    PLATFORM_LOAD_PHASE: context.phase,
    PLATFORM_LOAD_PHASE_TYPE: context.phaseType,
    PLATFORM_LOAD_SESSION_ID: context.sessionId,
    PLATFORM_LOAD_SCENARIO: context.scenario.name,
    PLATFORM_LOAD_TRAFFIC_KINDS: context.scenario.trafficKinds.join(","),
    PLATFORM_LOAD_TARGET_CONCURRENCY: String(context.targetConcurrency),
    PLATFORM_LOAD_DURATION_MS: String(context.durationMs),
  };
}
