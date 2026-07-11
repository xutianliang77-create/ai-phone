import type { AiCallingAgentDraftDto } from "@translation/contracts";

export interface AgentCallRecord extends AiCallingAgentDraftDto {
  userId: string;
  providerWebhookEventIds?: string[];
}
