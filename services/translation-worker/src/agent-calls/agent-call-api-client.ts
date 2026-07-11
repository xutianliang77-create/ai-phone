import type {
  AiCallingAgentDraftDto,
  AiCallingAgentDraftResponse,
  AiCallingAgentDraftsResponse,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";
import type { AgentCallApi } from "./types.js";

export interface HttpAgentCallApiClientOptions {
  apiBaseUrl: string;
  internalApiSecret?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpAgentCallApiClient implements AgentCallApi {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpAgentCallApiClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async listQueued(limit: number): Promise<AiCallingAgentDraftDto[]> {
    const response = await this.fetchWithTimeout(
      `${this.internalBaseUrl()}/queued?limit=${encodeURIComponent(String(limit))}`,
      { method: "GET", headers: this.headers() },
    );
    if (!response.ok) {
      throw new Error(`Agent call queue API returned HTTP ${response.status}`);
    }
    const body = await response.json() as AiCallingAgentDraftsResponse;
    return body.drafts ?? [];
  }

  async updateStatus(
    draftId: string,
    request: UpdateAiCallingAgentCallStatusRequest,
  ) {
    const response = await this.fetchWithTimeout(
      `${this.internalBaseUrl()}/${encodeURIComponent(draftId)}/status`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(request),
      },
    );
    if (!response.ok) {
      throw new Error(`Agent call status API returned HTTP ${response.status}`);
    }
    const body = await response.json() as AiCallingAgentDraftResponse;
    return body.draft;
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

  private internalBaseUrl() {
    return `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/ai-calling-agent/drafts`;
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.options.internalApiSecret
        ? { authorization: `Bearer ${this.options.internalApiSecret}` }
        : {}),
    };
  }
}
