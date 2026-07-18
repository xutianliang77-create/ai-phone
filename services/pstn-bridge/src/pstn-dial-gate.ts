import { createHash } from "node:crypto";
import type {
  AgentCallBridgeRequest,
  AgentCallBridgeResult,
} from "./types.js";

export interface PstnDialGate {
  execute(
    request: AgentCallBridgeRequest,
    dial: () => Promise<AgentCallBridgeResult>,
  ): Promise<AgentCallBridgeResult>;
}

export class InMemoryPstnDialGate implements PstnDialGate {
  private readonly entries = new Map<string, {
    requestHash: string;
    result: Promise<AgentCallBridgeResult>;
    createdAt: number;
  }>();

  execute(
    request: AgentCallBridgeRequest,
    dial: () => Promise<AgentCallBridgeResult>,
  ) {
    const requestHash = hashRequest(request);
    const existing = this.entries.get(request.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error("PSTN dial idempotency payload conflict");
      }
      return existing.result;
    }
    this.prune();
    const result = dial();
    this.entries.set(request.idempotencyKey, {
      requestHash,
      result,
      createdAt: Date.now(),
    });
    return result;
  }

  private prune(now = Date.now()) {
    if (this.entries.size < 10_000) return;
    const expiry = now - 24 * 60 * 60 * 1000;
    for (const [key, entry] of this.entries) {
      if (entry.createdAt < expiry) this.entries.delete(key);
    }
    if (this.entries.size < 10_000) return;
    const oldest = [...this.entries.entries()]
      .sort((left, right) => left[1].createdAt - right[1].createdAt)
      .slice(0, this.entries.size - 9_999);
    for (const [key] of oldest) this.entries.delete(key);
  }
}

function hashRequest(request: AgentCallBridgeRequest) {
  return createHash("sha256").update(JSON.stringify({
    draftId: request.draftId,
    callId: request.callId,
    targetPhone: request.targetPhone,
    objective: request.objective,
    suggestedScript: request.suggestedScript,
    language: request.language,
    consentPromptVersion: request.consentPromptVersion,
  })).digest("hex");
}
