#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");
const configuration = valueFlag("--configuration") ?? "Debug";
const builtAppPath = path.resolve(
  root,
  valueFlag("--built-app") ?? "apps/mobile/build/ios/iphoneos/Runner.app",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const settings = readBuildSettings(configuration);
const builtBundleId = builtAppBundleId(builtAppPath);
const failures = signingFailures(settings, builtBundleId);
const payload = {
  schemaVersion: 1,
  status: failures.length === 0 ? "ready" : "not_ready",
  configuration,
  builtApp: builtAppPath,
  settings: {
    developmentTeam: settings.DEVELOPMENT_TEAM ?? "",
    productBundleIdentifier: settings.PRODUCT_BUNDLE_IDENTIFIER ?? "",
    codeSignIdentity: settings.CODE_SIGN_IDENTITY ?? "",
    sdkRoot: settings.SDKROOT ?? "",
    supportedPlatforms: settings.SUPPORTED_PLATFORMS ?? "",
  },
  builtBundleIdentifier: builtBundleId,
  failures,
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (failures.length > 0) {
  console.error(failures.join("\n"));
} else {
  console.log(
    `iOS signing settings are ready: team=${payload.settings.developmentTeam}; bundle=${payload.settings.productBundleIdentifier}`,
  );
}

if (failures.length > 0) process.exit(1);

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
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function readBuildSettings(config) {
  const output = execFileSync("xcodebuild", [
    "-project",
    "apps/mobile/ios/Runner.xcodeproj",
    "-scheme",
    "Runner",
    "-configuration",
    config,
    "-destination",
    "generic/platform=iOS",
    "-showBuildSettings",
  ], { cwd: root, encoding: "utf8" });
  const settings = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s=\s(.*)$/);
    if (match) settings[match[1]] = match[2].trim();
  }
  return settings;
}

function builtAppBundleId(appPath) {
  const infoPlist = path.join(appPath, "Info.plist");
  if (!existsSync(infoPlist)) return null;
  try {
    return execFileSync(
      "plutil",
      ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPlist],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

function signingFailures(settings, builtBundleId) {
  const failures = [];
  if (!settings.DEVELOPMENT_TEAM) {
    failures.push("Runner Debug signing is missing DEVELOPMENT_TEAM.");
  }
  if (!isBundleIdentifier(settings.PRODUCT_BUNDLE_IDENTIFIER)) {
    failures.push("Runner Debug signing has an invalid PRODUCT_BUNDLE_IDENTIFIER.");
  }
  if (!/iPhone Developer|Apple Development/.test(settings.CODE_SIGN_IDENTITY ?? "")) {
    failures.push("Runner Debug CODE_SIGN_IDENTITY must be iPhone Developer or Apple Development.");
  }
  if (!String(settings.SDKROOT ?? "").includes("iPhoneOS")) {
    failures.push("Runner Debug SDKROOT must resolve to an iPhoneOS SDK.");
  }
  if (!String(settings.SUPPORTED_PLATFORMS ?? "").includes("iphoneos")) {
    failures.push("Runner Debug SUPPORTED_PLATFORMS must include iphoneos.");
  }
  if (builtBundleId !== null && builtBundleId !== settings.PRODUCT_BUNDLE_IDENTIFIER) {
    failures.push(
      `Built app bundle id ${builtBundleId || "missing"} does not match ${settings.PRODUCT_BUNDLE_IDENTIFIER}.`,
    );
  }
  return failures;
}

function isBundleIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(value ?? "");
}

function usage() {
  console.log(`Usage:
  scripts/check_ios_signing_settings.mjs [--json]
  scripts/check_ios_signing_settings.mjs [--configuration Debug] [--built-app PATH]

Checks the resolved Xcode signing settings used by physical iPhone smoke.`);
}
