import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { signedBuildEvidenceGate } from "./ios_nemotron_signed_build_evidence.mjs";
import { lmStudioProviderGate } from "./ios_nemotron_lmstudio_status_gate.mjs";
import { checkServices } from "./ios_nemotron_service_status_gate.mjs";
import { iosNemotronStaticStatusGates } from "./ios_nemotron_static_status_gates.mjs";

export async function buildStatusChecks({
  root,
  simulatorBuiltApp,
  deviceBuiltApp,
}) {
  const deviceReadiness = checkDeviceReadiness(root);
  const deviceReady = deviceReadiness.status === "pass";
  return [
    checkRuntimePermissions(root),
    checkSigningSettings(root, deviceBuiltApp),
    checkProvisioningProfile(root, deviceReady),
    checkCoreMlRuntime(root, deviceBuiltApp),
    ...iosNemotronStaticStatusGates(root),
    checkStagedModel(root),
    checkBuiltApp(
      "ios_simulator_build",
      simulatorBuiltApp,
      "build output missing; run flutter build ios --simulator --no-pub",
    ),
    checkBuiltModel(root, "built_simulator_app_nemotron_resource", simulatorBuiltApp),
    checkBuiltApp(
      "ios_device_build",
      deviceBuiltApp,
      "device build output missing; run flutter build ios --debug --no-codesign --no-pub",
    ),
    checkBuiltModel(root, "built_device_app_nemotron_resource", deviceBuiltApp),
    deviceReadiness,
    signedBuildEvidenceGate({ root, deviceReady }),
    lmStudioProviderGate(root),
    await checkServices(deviceReady),
  ];
}

function runScript(root, script, scriptArgs = [], options = {}) {
  return spawnSync(process.execPath, [path.join(root, script), ...scriptArgs], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function checkRuntimePermissions(root) {
  const result = runScript(root, "scripts/check_ios_runtime_permissions.mjs");
  return {
    name: "ios_runtime_permissions",
    status: result.status === 0 ? "pass" : "fail",
    message: compact(result.stdout || result.stderr),
  };
}

function checkSigningSettings(root, deviceBuiltApp) {
  const result = runScript(root, "scripts/check_ios_signing_settings.mjs", [
    "--json",
    "--built-app",
    deviceBuiltApp,
  ]);
  const payload = parseJson(result.stdout);
  return {
    name: "ios_signing_settings",
    status: result.status === 0 ? "pass" : "fail",
    message: payload
      ? signingMessage(payload)
      : compact(result.stderr || result.stdout),
    details: payload ?? null,
  };
}

function checkProvisioningProfile(root, deviceReady) {
  if (!deviceReady) {
    return {
      name: "ios_provisioning_profile",
      status: "pending",
      message: "waiting for physical_iphone_readiness before provisioning profile repair is required",
      details: {
        reason: "physical_iphone_readiness_not_ready",
      },
    };
  }
  const result = runScript(root, "scripts/check_ios_provisioning_profile.mjs", [
    "--json",
  ]);
  const payload = parseJson(result.stdout);
  return {
    name: "ios_provisioning_profile",
    status: result.status === 0 ? "pass" : "fail",
    message: payload
      ? provisioningMessage(payload)
      : compact(result.stderr || result.stdout),
    details: payload ?? null,
  };
}

function checkCoreMlRuntime(root, deviceBuiltApp) {
  const result = runScript(root, "scripts/check_ios_coreml_runtime.mjs", [
    deviceBuiltApp,
  ]);
  return {
    name: "ios_coreml_runtime",
    status: result.status === 0 ? "pass" : "fail",
    message: compact(result.stdout || result.stderr),
  };
}

function checkStagedModel(root) {
  const result = runScript(root, "scripts/validate_ios_nemotron_bundle.mjs", [
    "--json",
    "--allow-missing",
  ]);
  const payload = parseJson(result.stdout);
  return {
    name: "staged_nemotron_model",
    status: payload?.status === "ready" ? "pass" : "fail",
    message: payload
      ? `${payload.status} ${payload.layout} ${payload.root ?? ""}`.trim()
      : compact(result.stderr || result.stdout),
    details: payload
      ? { status: payload.status, layout: payload.layout, root: payload.root }
      : null,
  };
}

function checkBuiltApp(name, appPath, missingMessage) {
  return {
    name,
    status: existsSync(appPath) ? "pass" : "fail",
    message: existsSync(appPath)
      ? `built app exists: ${appPath}`
      : missingMessage,
  };
}

function checkBuiltModel(root, name, appPath) {
  const result = runScript(root, "scripts/check_ios_models_resource.mjs", [
    "--require-ready-model",
    "--require-vad-model",
    appPath,
  ]);
  const payload = parseJson(result.stdout);
  const model = payload?.model;
  const appSize = payload?.builtApp?.sizeMiB;
  const modelsSize = payload?.builtApp?.modelsSizeMiB;
  return {
    name,
    status: result.status === 0 && model?.status === "ready" ? "pass" : "fail",
    message: model
      ? [
          `${model.status} ${model.layout} ${model.root ?? ""}`.trim(),
          appSize == null ? null : `app=${appSize}MiB`,
          modelsSize == null ? null : `models=${modelsSize}MiB`,
          model.sizeMiB == null ? null : `selected=${model.sizeMiB}MiB`,
        ].filter(Boolean).join("; ")
      : compact(result.stderr || result.stdout),
    details: model ? { ...model, builtApp: payload?.builtApp ?? null } : null,
  };
}

function checkDeviceReadiness(root) {
  const result = runScript(root, "scripts/diagnose_ios_device.mjs", [
    "--require-ready",
    "--json",
  ]);
  const payload = parseJson(result.stdout);
  return {
    name: "physical_iphone_readiness",
    status: result.status === 0 ? "pass" : "fail",
    message: payload
      ? deviceReadinessMessage(payload)
      : compact(result.stderr || result.stdout),
    details: payload ?? null,
  };
}

function deviceReadinessMessage(payload) {
  if (payload.error) return payload.error;
  if (payload.physicalDeviceCount === 0) {
    return "devicectl did not report any physical iOS devices.";
  }
  if (payload.matchedDeviceCount === 0) {
    return `devicectl found ${payload.physicalDeviceCount} physical iOS device(s), but none matched DEVICE_ID=${payload.requestedDevice ?? ""}.`;
  }
  const devices = (payload.devices ?? []).map((device) => {
    const parts = [
      `${device.name ?? "unknown"} (${device.model ?? "unknown"}, iOS ${device.osVersion ?? "unknown"})`,
      `pairingState=${device.pairingState ?? "unknown"}`,
      `developerModeStatus=${device.developerModeStatus ?? "unknown"}`,
      `tunnelState=${device.tunnelState ?? "unknown"}`,
    ];
    for (const action of device.actions ?? []) parts.push(`action: ${action}`);
    return parts.join(" | ");
  });
  const finalState = payload.ready
    ? "ready for real-device Nemotron smoke"
    : "not ready for real-device Nemotron smoke";
  return compact([
    "iOS device diagnostic from devicectl",
    ...devices,
    finalState,
  ].join(" | "));
}

function signingMessage(payload) {
  if (payload.status !== "ready") {
    return (payload.failures ?? []).join("; ") ||
      "iOS signing settings are not ready.";
  }
  const settings = payload.settings ?? {};
  return [
    "iOS signing settings are ready",
    `team=${settings.developmentTeam ?? ""}`,
    `bundle=${settings.productBundleIdentifier ?? ""}`,
    `identity=${settings.codeSignIdentity ?? ""}`,
  ].join("; ");
}

function provisioningMessage(payload) {
  if (payload.status !== "ready") {
    const issues = payload.issues ?? [];
    const actions = (payload.actions ?? []).map((action) => `action: ${action}`);
    return [...issues, ...actions].join("; ") ||
      "iOS provisioning profile is not ready.";
  }
  const profile = payload.matchingProfiles?.[0] ?? {};
  return [
    "iOS provisioning profile is ready",
    `profile=${profile.name ?? ""}`,
    `uuid=${profile.uuid ?? ""}`,
    `bundle=${payload.requested?.bundleId ?? ""}`,
  ].join("; ");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function compact(text) {
  return String(text)
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" | ");
}
