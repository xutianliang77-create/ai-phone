import { WorkerPermissions } from "@livekit/agents";
import { TrackSource } from "@livekit/protocol";

export function createVoiceAgentWorkerPermissions() {
  return new WorkerPermissions(
    true,
    true,
    false,
    false,
    [TrackSource.MICROPHONE],
    false,
  );
}
