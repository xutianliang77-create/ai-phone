import type { AgentCallWorkerClaimDto } from "@translation/contracts";
import type { PstnBridge, PstnBridgeCallResult } from "./types.js";

export class HttpVoiceAgentRuntimeProvider implements PstnBridge {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async placeCall(claim: AgentCallWorkerClaimDto) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/ai-calling-agent/drafts/${
          encodeURIComponent(claim.draft.id)
        }/prepare-runtime`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-agent-worker-id": claim.workerId,
            "x-agent-call-lease-token": claim.leaseToken,
            ...(this.options.internalApiSecret
              ? { authorization: `Bearer ${this.options.internalApiSecret}` }
              : {}),
          },
          body: "{}",
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Voice Agent runtime API returned HTTP ${response.status}`);
      }
      return await response.json() as PstnBridgeCallResult;
    } finally {
      clearTimeout(timer);
    }
  }
}
