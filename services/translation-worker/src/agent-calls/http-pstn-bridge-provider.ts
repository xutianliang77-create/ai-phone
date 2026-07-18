import type { AgentCallWorkerClaimDto } from "@translation/contracts";
import type { PstnBridge, PstnBridgeCallResult } from "./types.js";

export interface HttpPstnBridgeProviderOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

interface PstnBridgeResponse extends PstnBridgeCallResult {}

export class HttpPstnBridgeProvider implements PstnBridge {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpPstnBridgeProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async placeCall(claim: AgentCallWorkerClaimDto): Promise<PstnBridgeCallResult> {
    const draft = claim.draft;
    const response = await this.fetchWithTimeout(this.callUrl(), {
      method: "POST",
      headers: {
        ...this.headers(),
        "idempotency-key": claim.dialIdempotencyKey,
      },
      body: JSON.stringify({
        idempotencyKey: claim.dialIdempotencyKey,
        draftId: draft.id,
        callId: draft.callId,
        targetName: draft.targetName,
        targetPhone: draft.targetPhone,
        objective: draft.objective,
        suggestedScript: draft.suggestedScript,
        language: draft.language,
        consentPromptVersion: draft.consentPromptVersion,
      }),
    });
    if (!response.ok) {
      throw new Error(`PSTN bridge returned HTTP ${response.status}`);
    }
    const body = await response.json() as PstnBridgeResponse;
    return { status: body.status ?? "in_progress", ...body };
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private callUrl() {
    return `${this.options.baseUrl.replace(/\/$/, "")}/agent-calls`;
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
    };
  }
}
