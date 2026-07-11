#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { configureMobileReleaseIdentity } from "./lib/mobile_release_identity_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const dryRun = takeFlag("--dry-run");

if (help) {
  usage();
  process.exit(0);
}

const options = {
  iosBundleId: takeValue("--ios-bundle-id") || process.env.TRANSLATION_IOS_BUNDLE_ID,
  iosTeamId: takeValue("--ios-team-id") || process.env.TRANSLATION_IOS_DEVELOPMENT_TEAM,
  androidApplicationId: takeValue("--android-application-id") ||
    process.env.TRANSLATION_ANDROID_APPLICATION_ID,
  androidNamespace: takeValue("--android-namespace") || process.env.TRANSLATION_ANDROID_NAMESPACE,
  androidStoreFile: takeValue("--android-store-file") || process.env.TRANSLATION_ANDROID_STORE_FILE,
  androidStorePassword: takeValue("--android-store-password") ||
    process.env.TRANSLATION_ANDROID_STORE_PASSWORD,
  androidKeyAlias: takeValue("--android-key-alias") || process.env.TRANSLATION_ANDROID_KEY_ALIAS,
  androidKeyPassword: takeValue("--android-key-password") ||
    process.env.TRANSLATION_ANDROID_KEY_PASSWORD,
  companyName: takeValue("--company-name") || process.env.MOBILE_RELEASE_COMPANY_NAME,
  dryRun,
};

if (args.length > 0) {
  console.error(`Unknown arguments: ${args.join(" ")}`);
  usage();
  process.exit(1);
}

const result = configureMobileReleaseIdentity(root, options);
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(dryRun ? "Mobile release identity dry run passed." : "Mobile release identity configured.");
  for (const file of result.files) console.log(`file: ${file.path}`);
  if (result.androidCertificateDname) {
    console.log(`android certificate dname: ${result.androidCertificateDname}`);
  }
} else {
  console.error(`Mobile release identity is not ready: ${result.issues.join("; ")}`);
  if (result.androidCertificateDname) {
    console.error(`android certificate dname: ${result.androidCertificateDname}`);
  }
}

process.exit(result.status === "ready" ? 0 : 1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${flag}`);
    process.exit(1);
  }
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/configure_mobile_release_identity.mjs [options]

Required options, also available as matching TRANSLATION_* env vars:
  --ios-bundle-id ID
  --ios-team-id TEAM_ID
  --android-application-id ID
  --android-store-file PATH
  --android-store-password PASSWORD
  --android-key-alias ALIAS
  --android-key-password PASSWORD

Optional:
  --android-namespace ID
  --company-name NAME
  --dry-run
  --json`);
}
