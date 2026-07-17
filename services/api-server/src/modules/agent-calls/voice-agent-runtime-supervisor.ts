import type { CallLinkWorkerRuntime } from "../call-links/call-link-worker-supervisor.js";
import { CallLinkWorkerDispatchRuntime } from
  "../worker-dispatches/call-link-worker-dispatch-runtime.js";
import { getVoiceAgentDispatchConfig } from "./voice-agent-runtime-readiness.js";

let runtime: CallLinkWorkerRuntime | null = null;
let testRuntime: CallLinkWorkerRuntime | null = null;

export function getVoiceAgentRuntimeSupervisor(): CallLinkWorkerRuntime {
  if (testRuntime) return testRuntime;
  if (runtime) return runtime;
  const config = getVoiceAgentDispatchConfig();
  if (!config.ok) return new UnavailableRuntime(config.issues);
  runtime = new CallLinkWorkerDispatchRuntime(
    config.config,
    undefined,
    `${process.env.INSTANCE_ID ?? `api-${process.pid}`}:voice-agent`,
    "voice_agent_runtime",
    "Voice Agent",
  );
  return runtime;
}

export function setVoiceAgentRuntimeSupervisorForTests(
  value: CallLinkWorkerRuntime | null,
) {
  testRuntime = value;
}

class UnavailableRuntime implements CallLinkWorkerRuntime {
  constructor(private readonly issues: string[]) {}
  ensure() {
    return Promise.reject(new Error(`Voice Agent dispatch is not ready: ${
      this.issues.join("; ")
    }`));
  }
  markReady() {}
  stop() {}
  shutdown() {}
}
