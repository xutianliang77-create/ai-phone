#!/usr/bin/env node
import process from "node:process";
import { iosNemotronRequiredRuntimeContract as contract } from "./lib/ios_nemotron_runtime_contract.mjs";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const env = {
  IOS_NEMOTRON_CONTRACT_DEVICE_ASR_PROVIDER: contract.deviceAsrProvider,
  IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS: contract.modelChunkMs,
  IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL: contract.autoDownloadModel,
  IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE: contract.sourceLanguage,
  IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE: contract.targetLanguage,
  IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS: contract.useLocalSessions,
  IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION:
    contract.useOnDeviceTranslation,
  IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER:
    contract.onDeviceTranslationProvider,
  IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED:
    contract.onDeviceTranslationRequired,
  IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER: contract.gatewayProvider,
  IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER: contract.gatewayAsrProvider,
  IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK:
    contract.gatewaySessionEventSink,
};

if (json) {
  console.log(JSON.stringify(env, null, 2));
} else {
  for (const [key, value] of Object.entries(env)) {
    console.log(`${key}=${shellQuote(String(value))}`);
  }
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function usage() {
  console.log(`Usage:
  scripts/ios_nemotron_runtime_contract_env.mjs [--json]

Exports the required iOS Nemotron MVP runtime contract as shell assignments.`);
}
