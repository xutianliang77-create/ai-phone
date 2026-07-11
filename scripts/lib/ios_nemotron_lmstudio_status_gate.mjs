import path from "node:path";
import process from "node:process";
import { iosNemotronRequiredRuntimeContract as contract } from "./ios_nemotron_runtime_contract.mjs";
import { loadLmStudioProviderEvidence } from "./lmstudio_provider_evidence.mjs";

export function lmStudioProviderGate(root) {
  if (usesLocalOnDeviceMvp()) {
    return {
      name: "lmstudio_translation_provider",
      status: "pass",
      message: "not required for local on-device MVP",
    };
  }
  const provider = process.env.REALTIME_PROVIDER ?? contract.gatewayProvider;
  if (provider !== "lmstudio") {
    return {
      name: "lmstudio_translation_provider",
      status: "pass",
      message: `not required for REALTIME_PROVIDER=${provider}`,
    };
  }
  const evidence = loadLmStudioProviderEvidence(
    path.join(root, ".cache/ios-nemotron-services/lmstudio-provider.json"),
    Number(process.env.IOS_NEMOTRON_LMSTUDIO_PROVIDER_MAX_AGE_HOURS ?? "2"),
  );
  return {
    name: "lmstudio_translation_provider",
    status: evidence.pass ? "pass" : "fail",
    message: lmStudioProviderMessage(evidence),
    details: {
      path: evidence.path,
      status: evidence.status,
      freshness: evidence.freshness,
      model: evidence.model ?? null,
      modelListed: evidence.modelListed ?? null,
      latencyMs: evidence.latencyMs ?? null,
      reasoningTokens: evidence.reasoningTokens ?? null,
    },
  };
}

function lmStudioProviderMessage(evidence) {
  if (evidence.pass) {
    return [
      "LM Studio translation provider is ready",
      `model=${evidence.model ?? "missing"}`,
      `latency=${evidence.latencyMs ?? "unknown"}ms`,
      `reasoningTokens=${evidence.reasoningTokens ?? "unknown"}`,
    ].join("; ");
  }
  return [
    ...(evidence.issues ?? []),
    ...(evidence.actions ?? []).map((action) => `action: ${action}`),
  ].join("; ") || "LM Studio translation provider is not ready.";
}

function usesLocalOnDeviceMvp() {
  return boolEnv("USE_LOCAL_SESSIONS", contract.useLocalSessions) &&
    boolEnv("USE_ON_DEVICE_TRANSLATION", contract.useOnDeviceTranslation);
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return Boolean(fallback);
  return value === "true";
}
