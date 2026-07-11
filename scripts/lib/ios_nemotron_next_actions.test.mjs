import { describe, expect, test } from "vitest";
import { nextActionText } from "./ios_nemotron_next_actions.mjs";

describe("nextActionText", () => {
  test("prioritizes wait-device run when the iPhone is not ready", () => {
    const text = nextActionText(baseInput({
      failedChecks: [
        { name: "ios_provisioning_profile", message: "No profiles." },
        { name: "physical_iphone_readiness", message: "Developer Mode disabled." },
      ],
      provisioningRepairEvidence: {
        issues: ["iPhone is not ready for provisioning repair"],
        actions: ["Enable Developer Mode"],
      },
      signedBuildEvidence: {
        issues: ["No iOS App Development provisioning profile matches app."],
        actions: ["Open Xcode signing settings."],
      },
    }));

    expect(text).toContain(
      'DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device -- --run',
    );
    expect(text).toContain("run the full MVP smoke");
    expect(text).not.toContain("Fix `ios_provisioning_profile`");
    expect(text).not.toContain("Signed build issue");
    expect(text).not.toContain("Provisioning repair issue");
  });

  test("does not surface pending provisioning until the iPhone is ready", () => {
    const text = nextActionText(baseInput({
      failedChecks: [
        { name: "physical_iphone_readiness", message: "Developer Mode disabled." },
      ],
      pendingChecks: [
        {
          name: "ios_provisioning_profile",
          message: "waiting for physical_iphone_readiness",
        },
      ],
    }));

    expect(text).toContain("wait-device -- --run");
    expect(text).not.toContain("Pending `ios_provisioning_profile`");
  });

  test("uses direct provisioning repair after the iPhone is ready", () => {
    const text = nextActionText(baseInput({
      failedChecks: [
        { name: "ios_provisioning_profile", message: "No profiles." },
      ],
    }));

    expect(text).toContain(
      'DEVICE_ID="Wha的iPhone" npm run ios:nemotron:repair-provisioning',
    );
  });

  test("runs the full MVP flow when only real-device evidence is pending", () => {
    const text = nextActionText(baseInput({
      pendingChecks: [
        {
          name: "api_gateway_services",
          message: "waiting for final e2e service evidence",
        },
      ],
    }));

    expect(text).toContain(
      'DEVICE_ID="Wha的iPhone" npm run ios:nemotron:run',
    );
    expect(text).toContain("Pending `api_gateway_services`");
  });

  test("checks LM Studio before final smoke when provider evidence failed", () => {
    const text = nextActionText(baseInput({
      lmStudioProviderEvidence: {
        pass: false,
        issues: ["LM Studio returned an empty translation."],
        actions: ["Load the configured translation model."],
      },
    }));

    expect(text).toContain("npm run ios:nemotron:check-lmstudio -- --json");
    expect(text).toContain("LM Studio provider issue");
    expect(text).toContain("Load the configured translation model.");
  });

  test("requires provisioning repair evidence before final acceptance", () => {
    const text = nextActionText(baseInput({
      provisioningRepairEvidence: {
        pass: false,
        issues: ["provisioning repair evidence file is missing"],
        actions: ["Run repair provisioning."],
      },
    }));

    expect(text).toContain("npm run ios:nemotron:repair-provisioning");
    expect(text).toContain("Provisioning repair issue");
    expect(text).not.toContain("MVP acceptance evidence is complete");
  });

  test("requires signed build evidence before final acceptance", () => {
    const text = nextActionText(baseInput({
      signedBuildEvidence: {
        pass: false,
        issues: ["signed build evidence is stale"],
        actions: ["Run signed preflight."],
      },
    }));

    expect(text).toContain("IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true");
    expect(text).toContain("Signed build issue");
    expect(text).not.toContain("MVP acceptance evidence is complete");
  });

  test("does not require LM Studio when another provider is selected", () => {
    const text = nextActionText(baseInput({
      lmStudioProviderEvidence: {
        required: false,
        pass: false,
        issues: ["LM Studio provider evidence file is missing."],
        actions: ["Run check-lmstudio."],
      },
    }));

    expect(text).not.toContain("check-lmstudio");
    expect(text).toContain("MVP acceptance evidence is complete");
  });

  test("surfaces structured smoke result issues before acceptance", () => {
    const text = nextActionText(baseInput({
      smokeEvidence: {
        fresh: true,
        issues: [
          "structured smoke result is missing: COREML_NEMOTRON_LOCAL_MVP_RESULT",
        ],
      },
      gatewayEvidence: { fresh: true, issues: [] },
    }));

    expect(text).toContain("npm run ios:nemotron:run");
    expect(text).toContain("Smoke evidence issue");
    expect(text).toContain("COREML_NEMOTRON_LOCAL_MVP_RESULT");
    expect(text).not.toContain("MVP acceptance evidence is complete");
  });

  test("surfaces Gateway evidence issues before acceptance", () => {
    const text = nextActionText(baseInput({
      smokeEvidence: { fresh: true, issues: [] },
      gatewayEvidence: {
        fresh: true,
        issues: ["Gateway text segment log marker is missing."],
      },
    }));

    expect(text).toContain("npm run ios:nemotron:run");
    expect(text).toContain("Gateway evidence issue");
    expect(text).toContain("text segment log marker is missing");
    expect(text).not.toContain("MVP acceptance evidence is complete");
  });
});

function baseInput(overrides = {}) {
  return {
    statusEvidence: {
      fresh: true,
      payload: { deviceId: "Wha的iPhone" },
    },
    failedChecks: [],
    pendingChecks: [],
    preflightEvidence: { pass: true },
    provisioningRepairEvidence: { pass: true, issues: [], actions: [] },
    signedBuildEvidence: { pass: true, issues: [], actions: [] },
    lmStudioProviderEvidence: { pass: true, issues: [], actions: [] },
    smokeEvidence: { fresh: true, issues: [] },
    gatewayEvidence: { fresh: true, issues: [] },
    missingSmoke: [],
    missingGateway: [],
    ...overrides,
  };
}
