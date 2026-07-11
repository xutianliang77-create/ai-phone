#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { configureAndroidReleaseKeystore } from "./lib/android_release_keystore_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const dryRun = takeFlag("--dry-run");
const overwrite = takeFlag("--overwrite");

if (help) {
  usage();
  process.exit(0);
}

const options = {
  applicationId: takeValue("--android-application-id") ||
    process.env.TRANSLATION_ANDROID_APPLICATION_ID,
  namespace: takeValue("--android-namespace") || process.env.TRANSLATION_ANDROID_NAMESPACE,
  storeFile: takeValue("--store-file") || process.env.TRANSLATION_ANDROID_STORE_FILE,
  storePassword: takeValue("--store-password") || process.env.TRANSLATION_ANDROID_STORE_PASSWORD,
  keyAlias: takeValue("--key-alias") || process.env.TRANSLATION_ANDROID_KEY_ALIAS,
  keyPassword: takeValue("--key-password") || process.env.TRANSLATION_ANDROID_KEY_PASSWORD,
  companyName: takeValue("--company-name") || process.env.MOBILE_RELEASE_COMPANY_NAME,
  dryRun,
  overwrite,
};

if (args.length > 0) {
  console.error(`Unknown arguments: ${args.join(" ")}`);
  usage();
  process.exit(1);
}

const result = configureAndroidReleaseKeystore(root, options);
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(dryRun ? "Android release keystore dry run passed." : "Android release keystore configured.");
  console.log(`storeFile: ${result.storeFile}`);
  console.log(`keyPropertiesFile: ${result.keyPropertiesFile}`);
  console.log(`android certificate dname: ${result.androidCertificateDname}`);
} else {
  console.error(`Android release keystore is not ready: ${result.issues.join("; ")}`);
  console.error(`android certificate dname: ${result.androidCertificateDname}`);
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
  scripts/generate_android_release_keystore.mjs [options]

Required:
  --android-application-id ID

Optional:
  --android-namespace ID
  --store-file PATH
  --store-password PASSWORD
  --key-alias ALIAS
  --key-password PASSWORD
  --company-name NAME
  --overwrite
  --dry-run
  --json

Missing passwords are generated automatically and written only to key.properties.`);
}
