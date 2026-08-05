import { TrackSource } from "@livekit/protocol";
import { describe, expect, it } from "vitest";
import { createVoiceAgentWorkerPermissions } from
  "./voice-agent-worker-permissions.js";

describe("Voice Agent worker permissions", () => {
  it("publishes exact microphone tracks as a visible room participant", () => {
    const permissions = createVoiceAgentWorkerPermissions();

    expect(permissions).toMatchObject({
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateMetadata: false,
      canPublishSources: [TrackSource.MICROPHONE],
      hidden: false,
    });
  });
});
