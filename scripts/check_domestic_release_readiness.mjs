#!/usr/bin/env node
import process from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkDomesticReleaseReadiness,
  checkDomesticReleaseReadinessOnLocalStack,
} from "./lib/domestic_release_readiness.mjs";
import { parseEnvFile } from "./lib/domestic_release_env_file_check.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const localStack = takeFlag("--local-stack");
const skipCallLinkWorker = takeFlag("--skip-call-link-worker");
const skipLiveKitRoomMedia = takeFlag("--skip-livekit-room-media");
const skipLiveKitSelfHost = takeFlag("--skip-livekit-selfhost");
const skipAgentCallWorker = takeFlag("--skip-agent-call-worker");
const skipPstnBridge = takeFlag("--skip-pstn-bridge");
const skipTtsProvider = takeFlag("--skip-tts-provider");
const skipPstnProviderMediaEvent = takeFlag("--skip-pstn-provider-media-event");
const skipPstnProviderStatusEvent = takeFlag(
  "--skip-pstn-provider-status-event",
);
const skipPstnInternalMediaLoop = takeFlag("--skip-pstn-internal-media-loop");
const skipModelSelection = takeFlag("--skip-model-selection");
const skipModelRouting = takeFlag("--skip-model-routing");
const skipReleaseMaterials = takeFlag("--skip-release-materials");
const skipReleaseEnvFile = takeFlag("--skip-release-env-file");
const skipDomesticPaymentCallbacksLocalSmoke = takeFlag(
  "--skip-domestic-payment-callbacks-local-smoke",
);
const skipDiagnosticsAlertingLocalSmoke = takeFlag(
  "--skip-diagnostics-alerting-local-smoke",
);
const envFile =
  valueFlag("--env-file") ?? process.env.DOMESTIC_RELEASE_ENV_FILE;
if (!help && envFile) applyEnvFile(envFile);
const capabilityProfile =
  valueFlag("--profile") ??
  process.env.DOMESTIC_RELEASE_CAPABILITY_PROFILE ??
  "commercial_full";
const output = path.resolve(
  root,
  valueFlag("--output") ?? ".cache/domestic-release-readiness.json",
);
const apiBaseUrl =
  valueFlag("--api-base-url") ??
  process.env.API_BASE_URL ??
  "http://127.0.0.1:3100";
const gatewayBaseUrl =
  valueFlag("--gateway-base-url") ??
  process.env.REALTIME_GATEWAY_BASE_URL ??
  `http://127.0.0.1:${process.env.REALTIME_PORT ?? 3001}`;
const pstnBridgeBaseUrl =
  valueFlag("--pstn-bridge-base-url") ?? process.env.PSTN_BRIDGE_BASE_URL ?? "";
const modelSelectionFile = path.resolve(
  root,
  valueFlag("--model-selection-file") ??
    process.env.MODEL_SELECTION_FILE ??
    "release/domestic/model-selection-report.json",
);
const modelRoutingFile = path.resolve(
  root,
  valueFlag("--model-routing-file") ??
    process.env.MODEL_ROUTING_FILE ??
    "release/domestic/model-routing.json",
);
const modelRoutingProfile =
  valueFlag("--model-routing-profile") ?? process.env.MODEL_ROUTING_PROFILE;
const releaseMaterialsFile =
  valueFlag("--release-materials-file") ??
  process.env.RELEASE_MATERIALS_FILE ??
  defaultReleaseMaterialsFile();
const releaseEnvFile =
  valueFlag("--release-env-file") ??
  process.env.DOMESTIC_RELEASE_ENV_FILE ??
  "release/domestic/release.env";
const liveKitSelfHostEnvFile =
  valueFlag("--livekit-selfhost-env") ??
  process.env.LIVEKIT_SELFHOST_ENV_FILE ??
  "infra/livekit-selfhost/.env";
const localApiPort = Number(
  valueFlag("--api-port") ?? process.env.DOMESTIC_LOCAL_API_PORT ?? 3410,
);
const localGatewayPort = Number(
  valueFlag("--gateway-port") ??
    process.env.DOMESTIC_LOCAL_GATEWAY_PORT ??
    3411,
);
const timeoutMs = Number(
  valueFlag("--timeout-ms") ??
    process.env.DOMESTIC_RELEASE_READINESS_TIMEOUT_MS ??
    15000,
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...(await (
    localStack
      ? checkDomesticReleaseReadinessOnLocalStack
      : checkDomesticReleaseReadiness
  )({
    root,
    apiBaseUrl,
    gatewayBaseUrl,
    pstnBridgeBaseUrl,
    modelSelectionFile,
    modelRoutingFile,
    modelRoutingProfile,
    releaseMaterialsFile,
    releaseEnvFile,
    liveKitSelfHostEnvFile,
    localApiPort,
    localGatewayPort,
    qwenBaseUrl:
      process.env.TRANSLATION_BASE_URL ??
      process.env.QWEN_BASE_URL ??
      "https://translation.example.cn/v1",
    qwenModel:
      process.env.TRANSLATION_MODEL ??
      process.env.QWEN_MODEL ??
      "tencent/Hy-MT2-1.8B",
    qwenApiKey: process.env.TRANSLATION_API_KEY ?? process.env.QWEN_API_KEY,
    qwenTimeoutMs: Number(
      process.env.TRANSLATION_TIMEOUT_MS ?? process.env.QWEN_TIMEOUT_MS ?? timeoutMs,
    ),
    qwenMaxTokens: Number(
      process.env.TRANSLATION_MAX_TOKENS ?? process.env.QWEN_MAX_TOKENS ?? 128,
    ),
    translationProvider:
      process.env.TRANSLATION_PROVIDER ??
      (process.env.REALTIME_PROVIDER === "qwen_live"
        ? "qwen_live"
        : "hymt2_self_hosted"),
    ttsHttpEndpoint: process.env.TTS_HTTP_ENDPOINT,
    ttsHttpApiKey: process.env.TTS_HTTP_API_KEY,
    ttsProvider: process.env.TTS_PROVIDER ?? "voxcpm2",
    ttsModel: process.env.TTS_MODEL ?? "VoxCPM2",
    ttsTimeoutMs: Number(process.env.TTS_HTTP_TIMEOUT_MS ?? timeoutMs),
    ttsMaxFirstAudioMs: Number(process.env.TTS_MAX_FIRST_AUDIO_MS ?? 1000),
    internalApiSecret: process.env.INTERNAL_API_SECRET,
    diagnosticsAdminToken: process.env.DIAGNOSTICS_ADMIN_TOKEN,
    timeoutMs,
    capabilityProfile,
    checkCallLinkWorker: !skipCallLinkWorker,
    checkLiveKitRoomMedia: !skipLiveKitRoomMedia,
    checkLiveKitSelfHost: !skipLiveKitSelfHost,
    checkAgentCallWorker: !skipAgentCallWorker,
    checkPstnBridge: !skipPstnBridge,
    checkTtsProvider: !skipTtsProvider,
    checkPstnProviderMediaEvent: !skipPstnProviderMediaEvent,
    checkPstnProviderStatusEvent: !skipPstnProviderStatusEvent,
    checkPstnInternalMediaLoop: !skipPstnInternalMediaLoop,
    checkModelSelection: !skipModelSelection,
    checkModelRouting: !skipModelRouting,
    checkReleaseMaterials: !skipReleaseMaterials,
    checkReleaseEnvFile: !skipReleaseEnvFile,
    checkDomesticPaymentCallbacksLocalSmoke:
      !skipDomesticPaymentCallbacksLocalSmoke,
    checkDiagnosticsAlertingLocalSmoke: !skipDiagnosticsAlertingLocalSmoke,
  })),
};

if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log("Domestic release readiness passed.");
} else {
  console.error(
    `Domestic release readiness failed: ${result.issues.join("; ")}`,
  );
  for (const check of result.checks) {
    console.error(
      `${check.status}: ${check.name}`,
    );
  }
  for (const action of result.actions) console.error(`action: ${action}`);
}

if (result.status !== "ready") process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-"))
    throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/check_domestic_release_readiness.mjs [--json]
  scripts/check_domestic_release_readiness.mjs --local-stack --json
  scripts/check_domestic_release_readiness.mjs --api-base-url http://127.0.0.1:3100 --gateway-base-url http://127.0.0.1:3001
  scripts/check_domestic_release_readiness.mjs --pstn-bridge-base-url http://127.0.0.1:3302
  scripts/check_domestic_release_readiness.mjs --model-selection-file release/domestic/model-selection-report.json
  scripts/check_domestic_release_readiness.mjs --model-routing-file release/domestic/model-routing.json
  scripts/check_domestic_release_readiness.mjs --model-routing-profile domestic_server_qwen3_hymt2_voxcpm2
  scripts/check_domestic_release_readiness.mjs --release-materials-file release/domestic/release-materials.json
  scripts/check_domestic_release_readiness.mjs --release-env-file release/domestic/release.env
  scripts/check_domestic_release_readiness.mjs --livekit-selfhost-env infra/livekit-selfhost/.env
  scripts/check_domestic_release_readiness.mjs --env-file release/domestic/release.env
  scripts/check_domestic_release_readiness.mjs --profile core_translation
  scripts/check_domestic_release_readiness.mjs --skip-call-link-worker
  scripts/check_domestic_release_readiness.mjs --skip-livekit-room-media
  scripts/check_domestic_release_readiness.mjs --skip-livekit-selfhost
  scripts/check_domestic_release_readiness.mjs --skip-agent-call-worker
  scripts/check_domestic_release_readiness.mjs --skip-pstn-bridge
  scripts/check_domestic_release_readiness.mjs --skip-tts-provider
  scripts/check_domestic_release_readiness.mjs --skip-pstn-provider-media-event
  scripts/check_domestic_release_readiness.mjs --skip-pstn-provider-status-event
  scripts/check_domestic_release_readiness.mjs --skip-pstn-internal-media-loop
  scripts/check_domestic_release_readiness.mjs --skip-model-selection
  scripts/check_domestic_release_readiness.mjs --skip-model-routing
  scripts/check_domestic_release_readiness.mjs --skip-release-materials
  scripts/check_domestic_release_readiness.mjs --skip-release-env-file
  scripts/check_domestic_release_readiness.mjs --skip-domestic-payment-callbacks-local-smoke
  scripts/check_domestic_release_readiness.mjs --skip-diagnostics-alerting-local-smoke

Verifies domestic release gates:
- Explicit capability profile: core_translation defers real SIP/Agent/Egress;
  commercial_full keeps all Provider gates mandatory
- Mobile app release metadata
- Domestic release secret file .gitignore hygiene
- Model selection readiness from MODEL_SELECTION_FILE
- Model routing readiness from MODEL_ROUTING_FILE
- Release materials readiness from RELEASE_MATERIALS_FILE
- Domestic production env file readiness from DOMESTIC_RELEASE_ENV_FILE
- Self-hosted LiveKit VM config readiness from LIVEKIT_SELFHOST_ENV_FILE
- API /health/release-ready
- Realtime Gateway /health/release-ready
- Server translation smoke using TRANSLATION_*; QWEN_* remains optional fallback
- VoxCPM2 TTS HTTP provider smoke using TTS_*
- Domestic WeChat/Alipay callback local smoke unless skipped
- PSTN Bridge /health/release-ready unless skipped
- PSTN provider signed media event smoke unless skipped
- PSTN provider signed status event smoke unless skipped
- PSTN internal media loop smoke unless skipped
- Diagnostics alerting local signed webhook smoke unless skipped
- Agent Call Worker queue/dispatch/settlement readiness unless skipped
- Call Link LiveKit Worker readiness unless skipped
- LiveKit room media readiness, including worker TTS audio track backfeed, unless skipped

Use --local-stack to start current-workspace API/Gateway on temporary ports before checking,
which avoids stale localhost services masking the real release blockers.`);
}

function applyEnvFile(file) {
  const loaded = parseEnvFile(readFileSync(path.resolve(root, file), "utf8"));
  for (const [key, value] of Object.entries(loaded)) {
    process.env[key] = value;
  }
  if (!process.env.DOMESTIC_RELEASE_ENV_FILE) {
    process.env.DOMESTIC_RELEASE_ENV_FILE = file;
  }
}

function defaultReleaseMaterialsFile() {
  const file = "release/domestic/release-materials.json";
  return existsSync(path.resolve(root, file)) ? file : "";
}
