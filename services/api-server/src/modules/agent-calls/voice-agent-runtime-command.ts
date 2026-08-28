import type {
  AiCallingAgentDraftDto,
  VoiceAgentRuntimeCommand,
} from "@translation/contracts";

export function resolveVoiceAgentRuntimeCommand(input: {
  draft: Pick<AiCallingAgentDraftDto, "status" | "agentControlState">;
  handoffTimedOut: boolean;
}): VoiceAgentRuntimeCommand {
  if (input.handoffTimedOut || input.draft.status === "cancelled") return "cancel";
  if (input.draft.status === "takeover_requested") return "takeover";
  return input.draft.agentControlState === "paused" ? "pause" : "continue";
}
