import type { JobContext } from "@livekit/agents";
import type { VoiceAgentRuntimeSnapshotDto } from "@translation/contracts";
import type { ProcessData } from "./agent-definition.js";
import type { VoiceAgentRuntimeEnv } from "./config.js";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { VoiceAgentDispatchTicket } from "./runtime-ticket.js";

export interface ManagedVoiceAgentSessionInput {
  env: VoiceAgentRuntimeEnv;
  api: VoiceAgentRuntimeApiClient;
  ticket: VoiceAgentDispatchTicket;
  snapshot: VoiceAgentRuntimeSnapshotDto;
  workerId: string;
  jobId: string;
  ctx: JobContext<ProcessData>;
}
