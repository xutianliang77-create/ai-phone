import { afterEach, describe, expect, it } from "vitest";
import {
  callLinkModelRuntimeAdmissionForSession,
} from "./call-link-model-runtime-policy.js";

describe("Call Link model runtime policy", () => {
  const previousDeployment = process.env.API_RESULT_SYNC_DEPLOYMENT_ID;

  afterEach(() => {
    if (previousDeployment === undefined) {
      delete process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
    } else {
      process.env.API_RESULT_SYNC_DEPLOYMENT_ID = previousDeployment;
    }
  });

  it("keeps legacy private Call Link behavior outside a public deployment", () => {
    delete process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
    expect(callLinkModelRuntimeAdmissionForSession({})).toEqual({
      ok: true,
      mode: "legacy_private",
    });
  });

  it("refuses to start the legacy Worker for an unbound public Call Link", () => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-test";
    expect(callLinkModelRuntimeAdmissionForSession({})).toEqual({
      ok: false,
      code: "call_link_public_model_authorization_required",
    });
  });

  it("does not mistake public session metadata for a Worker provider adapter", () => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-test";
    expect(callLinkModelRuntimeAdmissionForSession({
      processingDeploymentId: "public-test",
      processingAuthorization: { processingMode: "online" } as never,
    })).toEqual({
      ok: false,
      code: "call_link_public_model_runtime_unavailable",
    });
  });
});
