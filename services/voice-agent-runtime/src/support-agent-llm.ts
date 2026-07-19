import { randomUUID } from "node:crypto";
import { DEFAULT_API_CONNECT_OPTIONS, llm } from "@livekit/agents";
import type { EnterpriseSupportAgentWorkerSnapshot } from "@translation/contracts";
import type { SupportAgentApiClient } from "./support-agent-api-client.js";
import type { SupportAgentTicket } from "./support-agent-ticket.js";

export class ApiBackedSupportAgentLlm extends llm.LLM {
  private readonly authorized: Array<{ runId: string; turnId: string;
    stopAfterPlayout: boolean }> = [];

  constructor(private readonly input: {
    api: SupportAgentApiClient;
    ticket: () => SupportAgentTicket;
    snapshot: EnterpriseSupportAgentWorkerSnapshot;
    workerId: string;
  }) { super(); }

  label() { return "enterprise-support-agent-api"; }
  override get model() { return "server-validated-support-agent"; }
  override get provider() { return "enterprise-api"; }

  chat(options: Parameters<llm.LLM["chat"]>[0]) {
    return new SupportAgentLlmStream(this, options, async (signal) => {
      const history = options.chatCtx.items.flatMap((item) => {
        if (item.type !== "message" ||
          !["user", "assistant"].includes(item.role)) return [];
        const text = item.textContent?.trim();
        return text ? [{ id: item.id, role: item.role, text }] : [];
      });
      let currentIndex = -1;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index]?.role === "user") { currentIndex = index; break; }
      }
      const current = history[currentIndex];
      if (!current) throw new Error("Support Agent customer turn is missing");
      const response = await this.input.api.turn({ ticket: this.input.ticket(),
        workerId: this.input.workerId, inputTurnId: safeId(current.id),
        idempotencyKey: `support.turn:${safeId(current.id)}`,
        customerText: current.text,
        recentTurns: history.slice(0, currentIndex).slice(-12).map((item) => ({
          role: item.role === "user" ? "customer" as const : "assistant" as const,
          text: item.text,
        })), signal });
      const permit = await this.input.api.authorizeTts({ ticket: this.input.ticket(),
        workerId: this.input.workerId, runId: this.input.snapshot.runId,
        turnId: response.turnId, signal });
      if (permit.generation !== this.input.snapshot.generation ||
        permit.spokenText !== response.output.spokenText) {
        throw new Error("Support Agent TTS authorization binding failed");
      }
      this.authorized.push({ runId: this.input.snapshot.runId,
        turnId: response.turnId,
        stopAfterPlayout: ["handoff", "end"].includes(response.output.intent) });
      return response.output.spokenText;
    });
  }

  takeAuthorizedTurn() { return this.authorized.shift(); }
  clearAuthorizedTurns() { this.authorized.length = 0; }
}

class SupportAgentLlmStream extends llm.LLMStream {
  constructor(
    model: llm.LLM,
    options: Parameters<llm.LLM["chat"]>[0],
    private readonly generate: (signal: AbortSignal) => Promise<string>,
  ) {
    super(model, { chatCtx: options.chatCtx, toolCtx: options.toolCtx,
      connOptions: options.connOptions ?? DEFAULT_API_CONNECT_OPTIONS });
  }
  protected async run() {
    const content = await this.generate(this.abortController.signal);
    if (this.abortController.signal.aborted) return;
    this.queue.put({ id: randomUUID(), delta: { role: "assistant", content } });
  }
}

function safeId(value: string) {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/gu, "_").slice(0, 140);
  return normalized && /^[A-Za-z0-9]/.test(normalized)
    ? normalized : `turn_${randomUUID()}`;
}
