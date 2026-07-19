import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLiveKitCompatibilityProfile } from "./livekit_compatibility_profile.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("LiveKit compatibility profile", () => {
  it("matches the installed Node and Flutter SDK versions", () => {
    const result = checkLiveKitCompatibilityProfile({ root });
    expect(result.issues).toEqual([]);
    expect(result.status).toBe("ready");
  });

  it("blocks release until every service image is verified and digest-pinned", () => {
    const result = checkLiveKitCompatibilityProfile({ root, release: true });
    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("LiveKit server image is not verified");
    expect(result.issues).toContain("LiveKit sip image is not verified");
    expect(result.issues).not.toContain("LiveKit server image digest is not pinned");
    expect(result.issues).not.toContain("LiveKit sip image digest is not pinned");
  });
});
