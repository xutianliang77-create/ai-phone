import { afterEach, describe, expect, it } from "vitest";
import type { RealtimeProcessingAuthorization } from "@translation/contracts";
import {
  callLinkModelRuntimeAdmissionForSession,
} from "./call-link-model-runtime-policy.js";

describe("Call Link model runtime policy", () => {
  const previous = {
    deployment: process.env.API_RESULT_SYNC_DEPLOYMENT_ID,
    enabled: process.env.CALL_LINK_1_0_COMPATIBILITY_ENABLED,
    compatibilityDeployment: process.env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID,
    profile: process.env.CALL_LINK_1_0_COMPATIBILITY_PROFILE,
    policy: process.env.CALL_PROVIDER_POLICY,
    publicTts: process.env.CALL_LINK_PUBLIC_TTS_ENABLED,
  };

  afterEach(() => {
    restore("API_RESULT_SYNC_DEPLOYMENT_ID", previous.deployment);
    restore("CALL_LINK_1_0_COMPATIBILITY_ENABLED", previous.enabled);
    restore("CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID", previous.compatibilityDeployment);
    restore("CALL_LINK_1_0_COMPATIBILITY_PROFILE", previous.profile);
    restore("CALL_PROVIDER_POLICY", previous.policy);
    restore("CALL_LINK_PUBLIC_TTS_ENABLED", previous.publicTts);
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
      processingAuthorization: publicWorkerAuthorization(),
    })).toEqual({
      ok: false,
      code: "call_link_public_model_runtime_unavailable",
    });
  });

  it("requires a public grant for every Call Link model component", () => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-test";
    const authorization = publicWorkerAuthorization();
    authorization.executionPlan.tts = { execution: "disabled" };
    expect(callLinkModelRuntimeAdmissionForSession({
      processingDeploymentId: "public-test",
      processingAuthorization: authorization,
    })).toEqual({
      ok: false,
      code: "call_link_public_model_authorization_required",
    });
  });

  it("allows the explicitly isolated 1.0 Call Link compatibility lane", () => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-test";
    process.env.CALL_LINK_1_0_COMPATIBILITY_ENABLED = "true";
    process.env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID = "public-test";
    process.env.CALL_LINK_1_0_COMPATIBILITY_PROFILE = "call_link_only";
    process.env.CALL_PROVIDER_POLICY = "call_link_only";
    expect(callLinkModelRuntimeAdmissionForSession({})).toEqual({
      ok: true,
      mode: "isolated_1_0_compatibility",
    });
  });

  it("does not use the compatibility lane for SIP or Air780 entry points", () => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-test";
    process.env.CALL_LINK_1_0_COMPATIBILITY_ENABLED = "true";
    process.env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID = "public-test";
    process.env.CALL_LINK_1_0_COMPATIBILITY_PROFILE = "call_link_only";
    process.env.CALL_PROVIDER_POLICY = "call_link_only";
    for (const entryKind of ["sip_outbound", "sip_inbound", "air780"] as const) {
      expect(callLinkModelRuntimeAdmissionForSession({}, undefined, entryKind))
          .toEqual({
            ok: false,
            code: "call_link_public_model_authorization_required",
          });
    }
  });

  it("does not start a compatibility Worker with public TTS enabled but no sealed TTS material", () => {
    process.env.API_RESULT_SYNC_DEPLOYMENT_ID = "public-test";
    process.env.CALL_LINK_1_0_COMPATIBILITY_ENABLED = "true";
    process.env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID = "public-test";
    process.env.CALL_LINK_1_0_COMPATIBILITY_PROFILE = "call_link_only";
    process.env.CALL_PROVIDER_POLICY = "call_link_only";
    process.env.CALL_LINK_PUBLIC_TTS_ENABLED = "true";
    expect(callLinkModelRuntimeAdmissionForSession({})).toEqual({
      ok: false,
      code: "call_link_public_model_runtime_unavailable",
    });
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function publicWorkerAuthorization(): RealtimeProcessingAuthorization {
  const component = (scopeKey: string) => ({
    execution: "public" as const,
    scopeKey,
    reason: "online_selected" as const,
  });
  return {
    contractVersion: 1 as const,
    processingMode: "online" as const,
    modelPolicyRevision: "models-v1:test",
    languagePolicy: {
      source: "zh",
      target: "en",
      autoReverse: false,
      revision: 1,
    },
    executionPlan: {
      asr: component("asr:test"),
      translation: component("translation:test"),
      tts: component("tts:test"),
    },
    syncPermission: { allowed: false as const },
    publicGrantRef: "grant:test",
  };
}
