import type {
  AiCallingAgentDraftDto,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";

export type AgentCallWorkerStatus = UpdateAiCallingAgentCallStatusRequest["status"];

export interface AgentCallApi {
  listQueued(limit: number): Promise<AiCallingAgentDraftDto[]>;
  updateStatus(
    draftId: string,
    request: UpdateAiCallingAgentCallStatusRequest,
  ): Promise<AiCallingAgentDraftDto>;
}

export interface PstnBridgeCallResult {
  status?: AgentCallWorkerStatus;
  providerCallId?: string;
  resultSummary?: string;
  failureReason?: string;
  nextStep?: string;
}

export interface PstnBridge {
  placeCall(draft: AiCallingAgentDraftDto): Promise<PstnBridgeCallResult>;
}
