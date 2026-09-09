import type { RealtimeEnv } from "../config/env.js";
import { publicProcessingReadiness } from "./public-processing-readiness.js";

export type GatewayDependencyStatus = "ready" | "degraded" | "not_ready";

export interface GatewayDependencyServiceStatus {
  execution?: "public";
  name: "asr" | "translation" | "tts" | "speaker";
  requiredForSession: boolean;
  requiredForRelease: boolean;
  status: "ready" | "not_ready";
  url: string;
  issue?: string;
  identity?: Record<string, unknown>;
}

export interface GatewayDependencyReadiness {
  evidence?: "implementation_gate";
  status: GatewayDependencyStatus;
  sessionReady: boolean;
  releaseReady: boolean;
  checkedAt: string;
  issues: string[];
  warnings: string[];
  services: GatewayDependencyServiceStatus[];
}

interface DependencyProbe {
  name: GatewayDependencyServiceStatus["name"];
  url: string;
  requiredForSession: boolean;
  requiredForRelease: boolean;
  expectedService: string;
}

const INITIAL_READINESS: GatewayDependencyReadiness = {
  status: "not_ready",
  sessionReady: false,
  releaseReady: false,
  checkedAt: "not_checked",
  issues: ["Runtime dependency probe has not completed"],
  warnings: [],
  services: [],
};

export class GatewayDependencyReadinessMonitor {
  private current = INITIAL_READINESS;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly env: RealtimeEnv,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly intervalMs = 5_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readiness() {
    return this.current;
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh() {
    if (this.env.publicDeploymentId) {
      this.current = publicProcessingReadiness(this.now());
      return this.current;
    }
    const services = await Promise.all(
      dependencyProbes(this.env).map((probe) => probeDependency(
        probe,
        this.fetchFn,
        dependencyTimeoutMs(this.env, probe.name),
      )),
    );
    const requiredSessionFailures = services.filter(
      (service) => service.requiredForSession && service.status !== "ready",
    );
    const requiredReleaseFailures = services.filter(
      (service) => service.requiredForRelease && service.status !== "ready",
    );
    this.current = {
      status: requiredSessionFailures.length > 0
        ? "not_ready"
        : requiredReleaseFailures.length > 0 ? "degraded" : "ready",
      sessionReady: requiredSessionFailures.length === 0,
      releaseReady: requiredReleaseFailures.length === 0,
      checkedAt: this.now().toISOString(),
      issues: requiredSessionFailures.map(formatIssue),
      warnings: requiredReleaseFailures
        .filter((service) => !service.requiredForSession)
        .map(formatIssue),
      services,
    };
    return this.current;
  }
}

export function coreDependencyFailureStage(
  readiness: GatewayDependencyReadiness,
): "asr" | "translation" | "provider" | undefined {
  if (readiness.sessionReady) return undefined;
  const failed = readiness.services.find(
    (service) => service.requiredForSession && service.status !== "ready",
  );
  return failed?.name === "asr" || failed?.name === "translation"
    ? failed.name
    : "provider";
}

function dependencyProbes(env: RealtimeEnv): DependencyProbe[] {
  const probes: DependencyProbe[] = [];
  if (env.asrProvider === "http" && env.asrHttpEndpoint) {
    probes.push({
      name: "asr",
      url: env.asrHttpHealthUrl || healthUrl(env.asrHttpEndpoint),
      requiredForSession: true,
      requiredForRelease: true,
      expectedService: "asr-service",
    });
  }
  if (env.resolvedProvider === "lmstudio") {
    probes.push({
      name: "translation",
      url: healthUrl(env.lmStudioBaseUrl),
      requiredForSession: true,
      requiredForRelease: true,
      expectedService: "translation-service",
    });
  }
  if (env.ttsHttpEndpoint || env.ttsHttpStreamEndpoint) {
    probes.push({
      name: "tts",
      url: healthUrl(env.ttsHttpEndpoint || env.ttsHttpStreamEndpoint!),
      requiredForSession: false,
      requiredForRelease: true,
      expectedService: "tts-service",
    });
  }
  if (env.speakerProvider === "http" && env.speakerHttpBaseUrl) {
    probes.push({
      name: "speaker",
      url: healthUrl(env.speakerHttpBaseUrl),
      requiredForSession: false,
      requiredForRelease: true,
      expectedService: "speaker-service",
    });
  }
  return probes;
}

function dependencyTimeoutMs(env: RealtimeEnv, name: DependencyProbe["name"]) {
  const configured = name === "asr" ? env.asrHttpTimeoutMs
    : name === "translation" ? env.lmStudioTimeoutMs
    : name === "tts" ? env.ttsHttpTimeoutMs
    : env.speakerHttpTimeoutMs;
  return Math.max(250, Math.min(configured, 2_000));
}

function healthUrl(endpoint: string) {
  return new URL("/health", endpoint).toString();
}

async function probeDependency(
  probe: DependencyProbe,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<GatewayDependencyServiceStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(probe.url, { signal: controller.signal });
    if (!response.ok) return failed(probe, `HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    if (body.service !== probe.expectedService) {
      return failed(probe, `expected ${probe.expectedService}, got ${String(body.service)}`);
    }
    if (body.status !== "ok" || body.available === false) {
      return failed(probe, "service reports unavailable");
    }
    if (body.provider === "mock") return failed(probe, "mock provider is not runtime-ready");
    return {
      ...probe,
      status: "ready",
      identity: dependencyIdentity(body),
    };
  } catch (error) {
    return failed(probe, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function failed(probe: DependencyProbe, issue: string): GatewayDependencyServiceStatus {
  return { ...probe, status: "not_ready", issue };
}

function dependencyIdentity(body: Record<string, unknown>) {
  return Object.fromEntries([
    "service",
    "provider",
    "modelVersion",
    "mode",
    "vadProvider",
    "runtimeFingerprint",
    "vadModelFingerprint",
  ].filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
}

function formatIssue(service: GatewayDependencyServiceStatus) {
  return `${service.name}: ${service.issue ?? "not ready"}`;
}
