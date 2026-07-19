import type {
  EnterpriseSupportAgentRecentTurn,
  EnterpriseSupportAgentTurnResponse,
  EnterpriseSupportAgentWorkerSnapshot,
} from "@translation/contracts";
import type { SupportAgentRuntimeEnv } from "./support-agent-config.js";
import type { SupportAgentTicket } from "./support-agent-ticket.js";

export class SupportAgentApiClient {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly env: SupportAgentRuntimeEnv, fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  async snapshot(ticket: SupportAgentTicket, workerId: string) {
    const response = await this.post<{
      status: "accepted"; snapshot: EnterpriseSupportAgentWorkerSnapshot;
    }>("snapshot", this.worker(ticket, workerId));
    return response.snapshot;
  }
  heartbeat(ticket: SupportAgentTicket, workerId: string) {
    return this.post<{ status: string }>("heartbeat", this.worker(ticket, workerId));
  }
  refresh(ticket: SupportAgentTicket, workerId: string) {
    return this.post<{ status: "accepted"; ticket: string; expiresAt: string }>(
      "refresh", this.worker(ticket, workerId),
    );
  }
  turn(input: {
    ticket: SupportAgentTicket; workerId: string; inputTurnId: string;
    idempotencyKey: string; customerText: string;
    recentTurns: EnterpriseSupportAgentRecentTurn[];
    signal?: AbortSignal;
  }) {
    return this.post<EnterpriseSupportAgentTurnResponse>("turns", {
      ...this.worker(input.ticket, input.workerId),
      inputTurnId: input.inputTurnId, idempotencyKey: input.idempotencyKey,
      customerText: input.customerText, recentTurns: input.recentTurns,
    }, input.signal);
  }
  authorizeTts(input: { ticket: SupportAgentTicket; workerId: string;
    runId: string; turnId: string; signal?: AbortSignal }) {
    return this.post<{ status: "authorized"; generation: number; spokenText: string }>(
      "tts/authorize", { ...this.worker(input.ticket, input.workerId),
        runId: input.runId, turnId: input.turnId }, input.signal,
    );
  }
  delivered(input: { ticket: SupportAgentTicket; workerId: string;
    runId: string; turnId: string }) {
    return this.post<{ status: string }>("turns/delivered", {
      ...this.worker(input.ticket, input.workerId),
      runId: input.runId, turnId: input.turnId,
    });
  }
  finalize(ticket: SupportAgentTicket, workerId: string,
    outcome: "completed" | "failed") {
    return this.post<{ status: string }>("finalize", {
      ...this.worker(ticket, workerId), outcome,
    });
  }

  private worker(ticket: SupportAgentTicket, workerId: string) {
    return { ticket: ticket.ticket, workerCellId: this.env.workerCellId, workerId };
  }
  private async post<T>(path: string, body: unknown,
    externalSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), this.env.apiTimeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.env.apiBaseUrl}/internal/enterprise/support-agent/${path}`,
        { method: "POST", headers: { "content-type": "application/json",
          authorization: `Bearer ${this.env.internalApiSecret}` },
          body: JSON.stringify(body), signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`Support Agent API returned HTTP ${response.status}`);
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    }
  }
}
