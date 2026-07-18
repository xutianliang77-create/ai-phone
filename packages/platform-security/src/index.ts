import { createHmac } from "node:crypto";
import { createClient } from "@redis/client";

export type RateLimitProvider = "memory" | "redis";

export interface FixedWindowRateLimiterOptions {
  provider: RateLimitProvider;
  redisUrl?: string;
  keyPrefix: string;
  keySecret: string;
  connectTimeoutMs?: number;
  maxMemoryKeys?: number;
  onError?: (error: unknown) => void;
}

export interface RateLimitDecision {
  status: "allowed" | "limited" | "unavailable";
  provider: RateLimitProvider;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

interface MemoryWindow {
  count: number;
  expiresAtMs: number;
}

const incrementScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return current
`;

export class FixedWindowRateLimiter {
  private readonly memory = new Map<string, MemoryWindow>();
  private client: ReturnType<typeof createClient> | null = null;
  private connecting: Promise<boolean> | null = null;
  private closed = false;

  constructor(private readonly options: FixedWindowRateLimiterOptions) {}

  async start() {
    this.closed = false;
    return this.options.provider === "memory" ? true : this.connectRedis();
  }

  readiness() {
    const configured = this.options.provider === "memory" ||
      Boolean(this.options.redisUrl && this.options.keySecret);
    const connected = this.options.provider === "memory" ||
      this.client?.isReady === true;
    return {
      status: configured && connected ? "ready" as const : "not_ready" as const,
      provider: this.options.provider,
      configured,
      connected,
    };
  }

  async consume(input: {
    scope: string;
    identity: string;
    limit: number;
    windowMs: number;
    nowMs?: number;
  }): Promise<RateLimitDecision> {
    const nowMs = input.nowMs ?? Date.now();
    if (!validInput(input)) return unavailable(this.options.provider, input.limit);
    const bucket = Math.floor(nowMs / input.windowMs);
    const retryAfterMs = (bucket + 1) * input.windowMs - nowMs;
    const key = this.key(input.scope, input.identity, input.windowMs, bucket);
    if (this.options.provider === "memory") {
      const count = this.consumeMemory(key, nowMs, retryAfterMs);
      return decision(this.options.provider, count, input.limit, retryAfterMs);
    }
    if (!await this.connectRedis() || !this.client?.isReady) {
      return unavailable(this.options.provider, input.limit);
    }
    try {
      const value = await this.client.sendCommand([
        "EVAL",
        incrementScript,
        "1",
        key,
        String(Math.max(input.windowMs * 2, 1000)),
      ]);
      const count = Number(value);
      return Number.isSafeInteger(count) && count > 0
        ? decision(this.options.provider, count, input.limit, retryAfterMs)
        : unavailable(this.options.provider, input.limit);
    } catch (error) {
      this.options.onError?.(error);
      return unavailable(this.options.provider, input.limit);
    }
  }

  async close() {
    this.closed = true;
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (!client) return;
    try {
      if (client.isOpen) await client.close();
      else client.destroy();
    } catch {
      client.destroy();
    }
  }

  private consumeMemory(key: string, nowMs: number, retryAfterMs: number) {
    const current = this.memory.get(key);
    const count = current && current.expiresAtMs > nowMs ? current.count + 1 : 1;
    this.memory.set(key, { count, expiresAtMs: nowMs + retryAfterMs });
    if (this.memory.size > (this.options.maxMemoryKeys ?? 50_000)) {
      this.pruneMemory(nowMs);
    }
    return count;
  }

  private pruneMemory(nowMs: number) {
    for (const [key, value] of this.memory) {
      if (value.expiresAtMs <= nowMs) this.memory.delete(key);
    }
    const maximum = this.options.maxMemoryKeys ?? 50_000;
    while (this.memory.size > maximum) {
      const oldest = this.memory.keys().next().value;
      if (typeof oldest !== "string") break;
      this.memory.delete(oldest);
    }
  }

  private key(scope: string, identity: string, windowMs: number, bucket: number) {
    const digest = createHmac("sha256", this.options.keySecret)
      .update(identity)
      .digest("hex")
      .slice(0, 40);
    const safeScope = scope.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 80);
    return `${this.options.keyPrefix}:${safeScope}:${windowMs}:${bucket}:${digest}`;
  }

  private connectRedis() {
    if (this.closed) return Promise.resolve(false);
    if (this.client?.isReady) return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    if (!this.options.redisUrl || !this.options.keySecret) {
      return Promise.resolve(false);
    }
    const client = this.client ?? createClient({
      url: this.options.redisUrl,
      socket: {
        connectTimeout: this.options.connectTimeoutMs ?? 1500,
        reconnectStrategy: false,
      },
    });
    if (!this.client) {
      client.on("error", (error) => this.options.onError?.(error));
      this.client = client;
    }
    this.connecting = client.connect()
      .then(() => true)
      .catch((error) => {
        this.options.onError?.(error);
        if (this.client === client) this.client = null;
        client.destroy();
        return false;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }
}

function validInput(input: {
  scope: string;
  identity: string;
  limit: number;
  windowMs: number;
}) {
  return input.scope.length > 0 && input.identity.length > 0 &&
    Number.isSafeInteger(input.limit) && input.limit > 0 &&
    Number.isSafeInteger(input.windowMs) && input.windowMs >= 1000;
}

function decision(
  provider: RateLimitProvider,
  count: number,
  limit: number,
  retryAfterMs: number,
): RateLimitDecision {
  return {
    status: count <= limit ? "allowed" : "limited",
    provider,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterMs,
  };
}

function unavailable(provider: RateLimitProvider, limit: number): RateLimitDecision {
  return {
    status: "unavailable",
    provider,
    limit,
    remaining: 0,
    retryAfterMs: 1000,
  };
}
