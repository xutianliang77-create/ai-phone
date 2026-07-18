export type ProviderRoute = "primary" | "fallback";

export interface ProviderIdentity {
  provider: string;
  model?: string;
}

export interface ProviderFallbackTransition {
  callId: string;
  stage: "asr" | "translation" | "tts" | "llm";
  state: "degraded" | "restored";
  from: ProviderIdentity;
  to: ProviderIdentity;
  reason?: string;
}

interface SessionRoute {
  route: ProviderRoute;
  failures: number;
  recoveryProbe: boolean;
}

export class StickyProviderFallbackController {
  private readonly sessions = new Map<string, SessionRoute>();
  private primaryBlockedUntilMs = 0;
  private recoveryProbeCallId?: string;

  constructor(private readonly options: {
    stage: ProviderFallbackTransition["stage"];
    primary: ProviderIdentity;
    fallback: ProviderIdentity;
    failureThreshold: number;
    cooldownMs: number;
    nowMs?: () => number;
    onTransition?: (transition: ProviderFallbackTransition) => Promise<void> | void;
  }) {}

  open(callId: string) {
    const existing = this.sessions.get(callId);
    if (existing) return existing.route;
    const now = this.nowMs();
    const coolingDown = now < this.primaryBlockedUntilMs;
    const needsRecoveryProbe = this.primaryBlockedUntilMs > 0 && !coolingDown;
    const recoveryProbe = needsRecoveryProbe && !this.recoveryProbeCallId;
    const route = coolingDown || (needsRecoveryProbe && !recoveryProbe)
      ? "fallback"
      : "primary";
    if (recoveryProbe) this.recoveryProbeCallId = callId;
    this.sessions.set(callId, { route, failures: 0, recoveryProbe });
    return route;
  }

  route(callId: string) {
    return this.sessions.get(callId)?.route ?? this.open(callId);
  }

  async primarySucceeded(callId: string) {
    const session = this.sessions.get(callId);
    if (!session || session.route !== "primary") return;
    session.failures = 0;
    if (!session.recoveryProbe) return;
    session.recoveryProbe = false;
    this.recoveryProbeCallId = undefined;
    this.primaryBlockedUntilMs = 0;
    await this.report({
      callId,
      stage: this.options.stage,
      state: "restored",
      from: this.options.fallback,
      to: this.options.primary,
    });
  }

  async primaryFailed(
    callId: string,
    error: unknown,
    signal?: AbortSignal,
  ) {
    const session = this.sessions.get(callId) ?? this.createPrimarySession(callId);
    if (session.route === "fallback") return true;
    if (!isRetryableProviderFailure(error, signal)) return false;
    session.failures += 1;
    if (session.failures < Math.max(1, this.options.failureThreshold)) return false;
    session.route = "fallback";
    session.recoveryProbe = false;
    if (this.recoveryProbeCallId === callId) this.recoveryProbeCallId = undefined;
    this.primaryBlockedUntilMs = this.nowMs() + Math.max(0, this.options.cooldownMs);
    await this.report({
      callId,
      stage: this.options.stage,
      state: "degraded",
      from: this.options.primary,
      to: this.options.fallback,
      reason: errorMessage(error),
    });
    return true;
  }

  close(callId: string) {
    const session = this.sessions.get(callId);
    this.sessions.delete(callId);
    if (session?.recoveryProbe && this.recoveryProbeCallId === callId) {
      this.recoveryProbeCallId = undefined;
    }
  }

  private createPrimarySession(callId: string) {
    const session: SessionRoute = {
      route: "primary",
      failures: 0,
      recoveryProbe: false,
    };
    this.sessions.set(callId, session);
    return session;
  }

  private nowMs() {
    return (this.options.nowMs ?? Date.now)();
  }

  private async report(transition: ProviderFallbackTransition) {
    try {
      await this.options.onTransition?.(transition);
    } catch {
      // Observability must never prevent media fallback or recovery.
    }
  }
}

export function isRetryableProviderFailure(
  error: unknown,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return false;
  const status = httpStatus(error);
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

function httpStatus(error: unknown) {
  const message = errorMessage(error);
  const match = message.match(/\bHTTP\s+(\d{3})\b/iu);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
