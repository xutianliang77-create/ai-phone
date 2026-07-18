import { describe, expect, it } from "vitest";
import {
  isReleaseReadyLiveKitProfile,
  liveKitImageReference,
  type LiveKitCompatibilityProfile,
} from "./livekit-compatibility.js";

describe("LiveKit compatibility profile", () => {
  it("requires every component and image digest before release", () => {
    const profile = candidateProfile();
    expect(isReleaseReadyLiveKitProfile(profile)).toBe(false);

    profile.images.server.status = "verified";
    profile.images.server.digest = `sha256:${"a".repeat(64)}`;
    expect(isReleaseReadyLiveKitProfile(profile)).toBe(true);
  });

  it("builds immutable image references only when a digest exists", () => {
    const image = candidateProfile().images.server;
    expect(liveKitImageReference(image)).toBe(
      "livekit/livekit-server:v1.13.1",
    );
    image.digest = `sha256:${"b".repeat(64)}`;
    expect(liveKitImageReference(image)).toContain("@sha256:");
  });
});

function candidateProfile(): LiveKitCompatibilityProfile {
  return {
    schemaVersion: 1,
    profileVersion: "test",
    packages: {
      serverSdk: { version: "2.16.0", status: "verified" },
      browserClient: { version: "2.20.0", status: "verified" },
      rtcNode: { version: "0.13.30", status: "verified" },
      flutterClient: { version: "2.8.1", status: "verified" },
      agentsJs: { version: "", status: "not_integrated" },
    },
    images: {
      server: {
        repository: "livekit/livekit-server",
        tag: "v1.13.1",
        status: "candidate_unverified",
      },
      sip: { repository: "livekit/sip", status: "not_integrated" },
      egress: { repository: "livekit/egress", status: "not_integrated" },
      ingress: { repository: "livekit/ingress", status: "not_integrated" },
    },
  };
}
