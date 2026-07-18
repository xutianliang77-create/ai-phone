import { describe, expect, it } from "vitest";
import { liveKitSbomPlan } from "./list_livekit_sbom_images.mjs";

describe("LiveKit SBOM image plan", () => {
  it("includes only target-platform images pinned by tag and digest", () => {
    const pinned = {
      repository: "livekit/livekit-server",
      tag: "v1.13.3",
      digest: `sha256:${"a".repeat(64)}`,
      platform: "linux/amd64",
      status: "candidate_unverified",
    };
    const plan = liveKitSbomPlan({
      images: {
        server: pinned,
        sip: { ...pinned, repository: "livekit/sip" },
        egress: { repository: "livekit/egress", platform: "linux/amd64" },
        ingress: { repository: "livekit/ingress", tag: "latest" },
      },
    });

    expect(plan.matrix.include.map((item) => item.name)).toEqual(["server", "sip"]);
    expect(plan.missing).toEqual(["egress", "ingress"]);
    expect(plan.complete).toBe(false);
  });
});
