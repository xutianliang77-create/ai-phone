import { TrackSource } from "@livekit/protocol";
import { describe, expect, it } from "vitest";
import { createTranslationAgentPermissions } from "./translation-agent-permissions.js";

describe("translation agent permissions", () => {
  it("keeps the audio publisher visible while denying data and metadata writes", () => {
    expect(createTranslationAgentPermissions()).toMatchObject({
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateMetadata: false,
      canPublishSources: [TrackSource.MICROPHONE],
      hidden: false,
    });
  });
});
