import { WorkerPermissions } from "@livekit/agents";
import { TrackSource } from "@livekit/protocol";

export function createTranslationAgentPermissions() {
  return new WorkerPermissions(
    true,
    true,
    false,
    false,
    [TrackSource.MICROPHONE],
    false,
  );
}
