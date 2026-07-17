import type {
  AgentCallWorkerClaimDto,
  AgentCallWorkerClaimsResponse,
  AiCallingAgentDraftDto,
  AiCallingAgentDraftResponse,
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

  async claim(workerId: string, limit: number): Promise<AgentCallWorkerClaimDto[]> {
    const response = await this.fetchWithTimeout(
      `${this.internalBaseUrl()}/claims`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ workerId, limit }),
      },
    );
    if (!response.ok) {
      throw new Error(`Agent call queue API returned HTTP ${response.status}`);
    }
    const body = await response.json() as AgentCallWorkerClaimsResponse;
    return body.claims ?? [];
  }

  async updateStatus(
    claim: AgentCallWorkerClaimDto,
    request: UpdateAiCallingAgentCallStatusRequest,
  ) {
    const response = await this.fetchWithTimeout(
      `${this.internalBaseUrl()}/${encodeURIComponent(claim.draft.id)}/status`,
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "x-agent-worker-id": claim.workerId,
          "x-agent-call-lease-token": claim.leaseToken,
        },
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
