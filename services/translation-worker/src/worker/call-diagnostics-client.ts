import { randomUUID } from "node:crypto";
import type { AsrEndpointMode, RealtimeNodeDiagnosticsDto } from
  "@translation/contracts";
import type { TranslationWorkerEnv } from "../config/env.js";
import { buildRealtimeNodeDiagnostics } from "./call-runtime-diagnostics.js";
import type { LiveKitCallDiagnosticsSnapshot } from
  "./livekit-call-audio-source-types.js";

export class HttpCallDiagnosticsClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async report(callId: string, node: RealtimeNodeDiagnosticsDto) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
          encodeURIComponent(callId)
        }/diagnostics`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.options.internalApiSecret
              ? { authorization: `Bearer ${this.options.internalApiSecret}` }
              : {}),
          },
          body: JSON.stringify({ version: 1, node }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Worker diagnostics API returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export class CallDiagnosticsReporter {
  private readonly runtimeId: string;
  private readonly startedAtMs: number;

  constructor(private readonly options: {
    env: TranslationWorkerEnv;
    client: Pick<HttpCallDiagnosticsClient, "report">;
    generation?: number;
    endpointMode?: AsrEndpointMode;
    runtimeId?: string;
    nowMs?: () => number;
  }) {
    this.runtimeId = options.runtimeId ?? randomUUID();
    this.startedAtMs = (options.nowMs ?? Date.now)();
  }

  async report(callId: string, snapshot: LiveKitCallDiagnosticsSnapshot) {
    const endedAtMs = (this.options.nowMs ?? Date.now)();
    await this.options.client.report(callId, buildRealtimeNodeDiagnostics(
      this.options.env,
      snapshot,
      {
        runtimeId: this.runtimeId,
        startedAtMs: this.startedAtMs,
        endedAtMs,
        ...(this.options.generation === undefined
          ? {} : { generation: this.options.generation }),
        ...(this.options.endpointMode
          ? { endpointMode: this.options.endpointMode } : {}),
      },
    ));
  }
}
