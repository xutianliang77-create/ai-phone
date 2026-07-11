import type { RealtimeEnv } from "../config/env.js";
import type { UsageBalanceSnapshot } from "./usage-ticker.js";

export interface UsageBalanceClient {
  getBalance(userId: string): Promise<UsageBalanceSnapshot | null>;
}

export function createUsageBalanceClient(env: RealtimeEnv): UsageBalanceClient {
  return new ApiUsageBalanceClient({
    baseUrl: env.apiBaseUrl,
    internalApiSecret: env.internalApiSecret,
    timeoutMs: env.sessionSyncTimeoutMs,
  });
}

class ApiUsageBalanceClient implements UsageBalanceClient {
  constructor(private readonly options: {
    baseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
  }) {}

  async getBalance(userId: string): Promise<UsageBalanceSnapshot | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(
        `${this.normalizedBaseUrl()}/internal/usage/balance/${encodeURIComponent(userId)}`,
        {
          headers: {
            ...(this.options.internalApiSecret
              ? { authorization: `Bearer ${this.options.internalApiSecret}` }
              : {}),
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) return null;
      const body = await response.json() as {
        availableSeconds?: unknown;
        remainingSeconds?: unknown;
      };
      if (typeof body.remainingSeconds !== "number") return null;
      return {
        remainingSeconds: body.remainingSeconds,
        ...(typeof body.availableSeconds === "number"
          ? { availableSeconds: body.availableSeconds }
          : {}),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizedBaseUrl() {
    return this.options.baseUrl.replace(/\/$/, "");
  }
}
