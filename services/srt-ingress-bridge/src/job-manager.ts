import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { SrtIngressBridgeConfig } from "./config.js";

export type BridgeStatus = "starting" | "running" | "failed" | "stopped";

export interface BridgeJobView {
  bridgeId: string;
  status: BridgeStatus;
  connectionUrl?: string;
  replayed?: boolean;
  errorClass?: string;
}

interface BridgeJob {
  bodyHash: string;
  bridgeId: string;
  child: ChildProcess;
  errorClass?: string;
  exited: boolean;
  finishedAt?: number;
  idempotencyKey: string;
  maxTimer: NodeJS.Timeout;
  port: number;
  status: BridgeStatus;
}

export type CreateBridgeResult =
  | { kind: "created"; job: BridgeJobView }
  | { kind: "replayed"; job: BridgeJobView }
  | { kind: "conflict" }
  | { kind: "capacity" }
  | { kind: "failed"; job: BridgeJobView };

export class SrtIngressJobManager {
  private readonly byId = new Map<string, BridgeJob>();
  private readonly byIdempotency = new Map<string, BridgeJob>();
  private draining = false;

  constructor(
    private readonly config: SrtIngressBridgeConfig,
    private readonly spawnProcess: typeof spawn = spawn,
  ) {}

  async create(input: {
    idempotencyKey: string;
    targetUrl: string;
    maxDurationSeconds: number;
  }): Promise<CreateBridgeResult> {
    this.pruneTerminals();
    const bodyHash = sha256(JSON.stringify(input));
    const existing = this.byIdempotency.get(input.idempotencyKey);
    if (existing) {
      if (existing.bodyHash !== bodyHash) return { kind: "conflict" };
      return { kind: "replayed", job: view(existing, undefined, true) };
    }
    if (this.draining || this.activeCount() >= this.config.maxJobs) {
      return { kind: "capacity" };
    }
    const target = validateRtmpTarget(input.targetUrl, this.config.rtmpAllowedHosts);
    if (!target || input.maxDurationSeconds < 60 ||
      input.maxDurationSeconds > this.config.maxDurationSeconds) {
      return { kind: "conflict" };
    }
    const port = this.allocatePort();
    if (!port) return { kind: "capacity" };
    const passphrase = randomBytes(24).toString("base64url");
    const streamId = `publish:${randomBytes(16).toString("hex")}`;
    const listenerUrl = srtUrl("0.0.0.0", port, passphrase, streamId, this.config.latencyMs);
    const connectionUrl = srtUrl(
      this.config.publicHost,
      port,
      passphrase,
      streamId,
      this.config.latencyMs,
    ).replace("mode=listener", "mode=caller");
    const child = this.spawnProcess(
      this.config.ffmpegPath,
      ffmpegArguments(listenerUrl, target.toString()),
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const job: BridgeJob = {
      bodyHash,
      bridgeId: randomUUID(),
      child,
      exited: false,
      idempotencyKey: input.idempotencyKey,
      maxTimer: setTimeout(() => {
        this.terminate(job, "failed", "max_duration_exceeded");
      }, input.maxDurationSeconds * 1_000),
      port,
      status: "starting",
    };
    job.maxTimer.unref();
    this.byId.set(job.bridgeId, job);
    this.byIdempotency.set(job.idempotencyKey, job);
    child.stderr?.on("data", () => undefined);
    child.once("error", () => this.onExit(job));
    child.once("close", () => this.onExit(job));
    const started = await processStarted(child);
    if (!started) {
      this.terminate(job, "failed", "ffmpeg_start_failed");
      return { kind: "failed", job: view(job) };
    }
    if (job.status === "starting") job.status = "running";
    return { kind: "created", job: view(job, connectionUrl) };
  }

  get(bridgeId: string) {
    const job = this.byId.get(bridgeId);
    return job ? view(job) : null;
  }

  getByIdempotency(idempotencyKey: string) {
    const job = this.byIdempotency.get(idempotencyKey);
    return job ? view(job, undefined, true) : null;
  }

  stop(bridgeId: string) {
    const job = this.byId.get(bridgeId);
    if (!job) return null;
    this.terminate(job, "stopped");
    return view(job);
  }

  summary() {
    return {
      activeJobs: this.activeCount(),
      draining: this.draining,
      maxJobs: this.config.maxJobs,
    };
  }

  async drain() {
    this.draining = true;
    for (const job of this.byId.values()) {
      if (isActive(job.status)) this.terminate(job, "stopped");
    }
    const deadline = Date.now() + this.config.shutdownGraceMs;
    while (this.runningProcessCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private activeCount() {
    return this.runningProcessCount();
  }

  private allocatePort() {
    const used = new Set([...this.byId.values()].filter((job) => !job.exited)
      .map((job) => job.port));
    for (let port = this.config.portMin; port <= this.config.portMax; port += 1) {
      if (!used.has(port)) return port;
    }
    return null;
  }

  private terminate(job: BridgeJob, status: "failed" | "stopped", errorClass?: string) {
    if (!isActive(job.status)) return;
    job.status = status;
    job.errorClass = errorClass;
    job.finishedAt = Date.now();
    clearTimeout(job.maxTimer);
    job.child.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      if (!job.exited) job.child.kill("SIGKILL");
    }, this.config.shutdownGraceMs);
    killTimer.unref();
  }

  private onExit(job: BridgeJob) {
    if (job.exited) return;
    job.exited = true;
    clearTimeout(job.maxTimer);
    if (isActive(job.status)) {
      job.status = "failed";
      job.errorClass = "bridge_process_failed";
      job.finishedAt = Date.now();
    }
  }

  private pruneTerminals() {
    const limit = this.config.maxJobs * 100;
    if (this.byId.size < limit) return;
    const terminal = [...this.byId.values()].filter((job) =>
      !isActive(job.status) && job.exited
    )
      .sort((left, right) => (left.finishedAt ?? 0) - (right.finishedAt ?? 0));
    for (const job of terminal.slice(0, Math.max(1, this.byId.size - limit + 1))) {
      this.byId.delete(job.bridgeId);
      this.byIdempotency.delete(job.idempotencyKey);
    }
  }

  private runningProcessCount() {
    return [...this.byId.values()].filter((job) => !job.exited).length;
  }
}

export function validateRtmpTarget(value: string, allowedHosts: string[]) {
  try {
    const target = new URL(value);
    if (!["rtmp:", "rtmps:"].includes(target.protocol) || target.username ||
      target.password || target.hash || target.search ||
      !target.pathname || target.pathname === "/") {
      return null;
    }
    return allowedHosts.includes(target.hostname.toLowerCase()) ? target : null;
  } catch {
    return null;
  }
}

function ffmpegArguments(listenerUrl: string, targetUrl: string) {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "warning",
    "-fflags", "+genpts", "-i", listenerUrl,
    "-map", "0:v:0?", "-map", "0:a:0?",
    "-c:v", "copy", "-c:a", "copy", "-f", "flv", targetUrl,
  ];
}

function srtUrl(host: string, port: number, passphrase: string, streamId: string, latency: number) {
  const query = new URLSearchParams({
    mode: "listener",
    passphrase,
    pbkeylen: "32",
    latency: String(latency),
    transtype: "live",
    streamid: streamId,
  });
  return `srt://${host}:${port}?${query}`;
}

function processStarted(child: ChildProcess) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once("spawn", () => {
      const timer = setTimeout(() => finish(child.exitCode === null), 150);
      timer.unref();
    });
    child.once("error", () => finish(false));
    child.once("exit", () => finish(false));
  });
}

function view(job: BridgeJob, connectionUrl?: string, replayed = false): BridgeJobView {
  return {
    bridgeId: job.bridgeId,
    status: job.status,
    ...(connectionUrl ? { connectionUrl } : {}),
    ...(replayed ? { replayed: true } : {}),
    ...(job.errorClass ? { errorClass: job.errorClass } : {}),
  };
}

function isActive(status: BridgeStatus) {
  return status === "starting" || status === "running";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
