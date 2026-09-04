import type {
  CommunicationProvider,
  ProviderOperationType,
} from "@translation/contracts";

export type AgentCallProvider = Extract<
  CommunicationProvider,
  "air780_volte" | "livekit_sip" | "pstn_http" | "pstn_fonoster"
>;

export const agentCallDialToolName = "place_phone_call";

export function configuredAgentCallProvider(): AgentCallProvider | null {
  const value = process.env.AGENT_CALL_PROVIDER_ADAPTER;
  return isAgentCallProvider(value) ? value : null;
}

export function isAgentCallProvider(value: unknown): value is AgentCallProvider {
  return value === "air780_volte" || value === "livekit_sip" ||
    value === "pstn_http" || value === "pstn_fonoster";
}

export function agentCallDialOperationType(): ProviderOperationType {
  return "phone_outbound";
}

export function isAgentCallDialOperation(input: {
  provider: CommunicationProvider;
  operationType: ProviderOperationType;
}) {
  return input.operationType === "phone_outbound" ||
    (input.provider === "livekit_sip" && input.operationType === "sip_outbound");
}

export function agentCallUsesVoiceRuntime(provider: AgentCallProvider | null) {
  return provider === "air780_volte" || provider === "livekit_sip";
}
