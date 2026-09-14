import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

describe("public Tencent preset-TTS capability boundary", () => {
  const priorDeploymentId = process.env.API_RESULT_SYNC_DEPLOYMENT_ID;

  beforeEach(() => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-voice-capability-test";
  });

  afterEach(() => {
    if (priorDeploymentId === undefined) {
      delete process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
    } else {
      process.env.API_RESULT_SYNC_DEPLOYMENT_ID = priorDeploymentId;
    }
  });

  it("does not expose reference-audio or voice-identity routes", async () => {
    const app = await buildApp();
    const [profile, identity] = await Promise.all([
      app.inject({ method: "GET", url: "/voice-profiles/me" }),
      app.inject({ method: "GET", url: "/voice-identities" }),
    ]);
    await app.close();

    expect(profile.statusCode).toBe(404);
    expect(identity.statusCode).toBe(404);
  });
});
