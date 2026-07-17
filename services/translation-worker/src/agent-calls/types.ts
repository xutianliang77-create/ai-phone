import type {
  AgentCallWorkerClaimDto,
  AiCallingAgentDraftDto,
  UpdateAiCallingAgentCallStatusRequest,
} from "@translation/contracts";

export type AgentCallWorkerStatus = UpdateAiCallingAgentCallStatusRequest["status"];

export interface AgentCallApi {
  claim(workerId: string, limit: number): Promise<AgentCallWorkerClaimDto[]>;
  updateStatus(
    claim: AgentCallWorkerClaimDto,
    request: UpdateAiCallingAgentCallStatusRequest,
  ): Promise<AiCallingAgentDraftDto>;
}

export interface PstnBridgeCallResult {
  status?: AgentCallWorkerStatus;
  providerOperationStatus?: UpdateAiCallingAgentCallStatusRequest[
    "providerOperationStatus"
  ];
  providerCallId?: string;
  resultSummary?: string;
  failureReason?: string;
  nextStep?: string;
}

export interface PstnBridge {
  placeCall(claim: AgentCallWorkerClaimDto): Promise<PstnBridgeCallResult>;
}
