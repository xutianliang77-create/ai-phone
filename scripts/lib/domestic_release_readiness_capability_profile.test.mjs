import { describe, expect, test } from "vitest";
import { checkDomesticReleaseReadiness } from
  "./domestic_release_readiness.mjs";
import {
  baseOptions,
  fakeFetch,
  readyMobileAppRelease,
} from "./domestic_release_readiness_test_helpers.mjs";

describe("domestic release readiness capability profile", () => {
  test("marks SIP, Agent, Egress, and payment deferred in core translation", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      capabilityProfile: "core_translation",
      pstnBridgeBaseUrl: "",
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("ready");
    expect(result.capabilityProfile).toBe("core_translation");
    expect(result.deferredCapabilities).toEqual([
      "livekit_sip",
      "agent",
      "egress",
      "payment",
    ]);
    for (const name of [
      "pstn_bridge_release_ready",
      "pstn_provider_media_event_readiness",
      "pstn_provider_status_event_readiness",
      "pstn_internal_media_loop_readiness",
      "agent_call_worker_readiness",
      "domestic_payment_callbacks_local_smoke",
    ]) {
      expect(result.checks.find((check) => check.name === name)).toMatchObject({
        status: "deferred",
        details: {
          skipped: true,
          disposition: "deferred_by_core_translation_profile",
        },
      });
    }
  });
});
