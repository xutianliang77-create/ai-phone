import type { UpdateAiCallingAgentCallStatusRequest } from "@translation/contracts";
import type { AgentCallApi, PstnBridge, PstnBridgeCallResult } from "./types.js";

export interface AgentCallDispatcherOptions {
  api: AgentCallApi;
  bridge: PstnBridge;
  batchSize: number;
}

export class AgentCallDispatcher {
  constructor(private readonly options: AgentCallDispatcherOptions) {}

  async dispatchOnce() {
    const drafts = await this.options.api.listQueued(this.options.batchSize);
    for (const draft of drafts) {
      try {
        const result = await this.options.bridge.placeCall(draft);
        await this.options.api.updateStatus(draft.id, toStatusRequest(result));
      } catch (error) {
        await this.options.api.updateStatus(draft.id, {
          status: "failed",
          failureReason: errorMessage(error),
          nextStep: "请检查 PSTN Bridge 配置和服务商通话日志。",
        });
      }
    }
    return drafts.length;
  }
}

function toStatusRequest(
  result: PstnBridgeCallResult,
): UpdateAiCallingAgentCallStatusRequest {
  return {
    status: result.status ?? "in_progress",
    providerCallId: result.providerCallId,
    resultSummary: result.resultSummary,
    failureReason: result.failureReason,
    nextStep: result.nextStep,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown pstn bridge error";
}
