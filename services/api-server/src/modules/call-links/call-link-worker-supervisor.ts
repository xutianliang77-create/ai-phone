import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { CallLinkWorkerDispatchRuntime } from "../worker-dispatches/call-link-worker-dispatch-runtime.js";
import {
  getLiveKitDispatchConfig,
  workerRuntimeProvider,
} from "../worker-dispatches/livekit-dispatch-readiness.js";
import type { WorkerDispatchTicketPayload } from "../worker-dispatches/worker-dispatch-ticket.js";

export interface WorkerRuntimeClaim {
  generation: number;
  workerId?: string;
  jobId?: string;
}

export interface ManagedCallLinkWorkerProcess {
  onceExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  onceError(listener: (error: Error) => void): void;
  kill(signal: NodeJS.Signals): void;
}

export interface CallLinkWorkerRuntime {
  ensure(callId: string): Promise<void>;
  markReady(callId: string, claim?: WorkerRuntimeClaim): void;
  heartbeat?(callId: string, claim: WorkerRuntimeClaim): unknown;
  reportFailure?(callId: string, claim: WorkerRuntimeClaim, errorClass?: string): void;
  verifyTicket?(ticket: string): WorkerDispatchTicketPayload | null;
  stop(callId: string): void | Promise<void>;
  shutdown(): void | Promise<void>;
}

type WorkerLauncher = (callId: string) => ManagedCallLinkWorkerProcess;

interface WorkerEntry {
  process: ManagedCallLinkWorkerProcess;
  readiness: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  ready: boolean;
  timeout: NodeJS.Timeout;
}

export class CallLinkWorkerSupervisor implements CallLinkWorkerRuntime {
  private readonly entries = new Map<string, WorkerEntry>();

  constructor(
    private readonly launch: WorkerLauncher = launchWorkerProcess,
    private readonly readyTimeoutMs = 10_000,
  ) {}

  ensure(callId: string) {
    const existing = this.entries.get(callId);
    if (existing) return existing.readiness;

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const readiness = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const workerProcess = this.launch(callId);
    const entry: WorkerEntry = {
      process: workerProcess,
      readiness,
      resolveReady,
      rejectReady,
      ready: false,
      timeout: setTimeout(() => {
        this.fail(callId, entry, new Error("Call Link Worker join timed out"));
      }, this.readyTimeoutMs),
    };
    this.entries.set(callId, entry);
    workerProcess.onceError((error) => this.fail(callId, entry, error));
    workerProcess.onceExit((code, signal) => {
      this.fail(
        callId,
        entry,
        new Error(`Call Link Worker exited (${code ?? signal ?? "unknown"})`),
        false,
      );
    });
    return readiness;
  }

  markReady(callId: string) {
    const entry = this.entries.get(callId);
    if (!entry || entry.ready) return;
    entry.ready = true;
    clearTimeout(entry.timeout);
    entry.resolveReady();
  }

  stop(callId: string) {
    const entry = this.entries.get(callId);
    if (!entry) return;
    this.entries.delete(callId);
    clearTimeout(entry.timeout);
    if (!entry.ready) {
      entry.rejectReady(new Error("Call Link Worker stopped before joining"));
    }
    entry.process.kill("SIGTERM");
  }

  shutdown() {
    for (const callId of [...this.entries.keys()]) this.stop(callId);
  }

  private fail(
    callId: string,
    entry: WorkerEntry,
    error: Error,
    terminate = true,
  ) {
    if (this.entries.get(callId) !== entry) return;
    this.entries.delete(callId);
    clearTimeout(entry.timeout);
    if (!entry.ready) entry.rejectReady(error);
    if (terminate) entry.process.kill("SIGTERM");
  }
}

const defaultSupervisor = new CallLinkWorkerSupervisor();
let defaultDispatchRuntime: CallLinkWorkerDispatchRuntime | null = null;
let testSupervisor: CallLinkWorkerRuntime | null = null;

export function getCallLinkWorkerSupervisor(): CallLinkWorkerRuntime {
  if (testSupervisor) return testSupervisor;
  if (workerRuntimeProvider() === "local_process") return defaultSupervisor;
  if (defaultDispatchRuntime) return defaultDispatchRuntime;
  const config = getLiveKitDispatchConfig();
  if (!config.ok) return new UnavailableCallLinkWorkerRuntime(config.issues);
  defaultDispatchRuntime = new CallLinkWorkerDispatchRuntime(config.config);
  return defaultDispatchRuntime;
}

class UnavailableCallLinkWorkerRuntime implements CallLinkWorkerRuntime {
  constructor(private readonly issues: string[]) {}
  ensure() {
    return Promise.reject(new Error(`LiveKit dispatch is not ready: ${this.issues.join("; ")}`));
  }
  markReady() {}
  stop() {}
  shutdown() {}
}

export function setCallLinkWorkerSupervisorForTests(
  supervisor: CallLinkWorkerRuntime | null,
) {
  testSupervisor = supervisor;
}

function launchWorkerProcess(callId: string): ManagedCallLinkWorkerProcess {
  const entrypoint = resolve(
    process.cwd(),
    "services/translation-worker/dist/main.js",
  );
  const child = spawn(process.execPath, [entrypoint], {
    env: {
      ...process.env,
      TRANSLATION_WORKER_CALL_ID: callId,
      TRANSLATION_WORKER_PARTICIPANT_NAME: `translation-worker-${callId.slice(0, 8)}`,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return {
    onceExit(listener) {
      child.once("exit", listener);
    },
    onceError(listener) {
      child.once("error", listener);
    },
    kill(signal) {
      child.kill(signal);
    },
  };
}
