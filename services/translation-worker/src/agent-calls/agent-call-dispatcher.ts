import type { UpdateAiCallingAgentCallStatusRequest } from "@translation/contracts";
import type { AgentCallApi, PstnBridge, PstnBridgeCallResult } from "./types.js";

export interface AgentCallDispatcherOptions {
  api: AgentCallApi;
  bridge: PstnBridge;
  batchSize: number;
  workerId: string;
}

export class AgentCallDispatcher {
  constructor(private readonly options: AgentCallDispatcherOptions) {}

  async dispatchOnce() {
    const claims = await this.options.api.claim(
      this.options.workerId,
      this.options.batchSize,
    );
    for (const claim of claims) {
      try {
        const result = await this.options.bridge.placeCall(claim);
        await this.options.api.updateStatus(claim, toStatusRequest(result));
      } catch (error) {
        await this.options.api.updateStatus(claim, {
          status: "failed",
          providerOperationStatus: "unknown",
          failureReason: errorMessage(error),
          nextStep: "请核对 PSTN 服务商记录；确认未拨号前不得重试。",
        });
      }
    }
    return claims.length;
  }
}

function toStatusRequest(
  result: PstnBridgeCallResult,
): UpdateAiCallingAgentCallStatusRequest {
  return {
    status: result.status ?? "in_progress",
    providerOperationStatus: result.providerOperationStatus ??
      (result.status === "completed" ? "succeeded"
        : result.status === "failed" ? "failed" : "accepted"),
    providerCallId: result.providerCallId,
    resultSummary: result.resultSummary,
    failureReason: result.failureReason,
    nextStep: result.nextStep,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown pstn bridge error";
}
