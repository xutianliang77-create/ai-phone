#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const infoPlist = resolve(root, "apps/mobile/ios/Runner/Info.plist");
const localizedFiles = [
  resolve(root, "apps/mobile/ios/Runner/zh-Hans.lproj/InfoPlist.strings"),
  resolve(root, "apps/mobile/ios/Runner/en.lproj/InfoPlist.strings"),
];

const requiredInfoKeys = [
  "NSMicrophoneUsageDescription",
  "NSLocalNetworkUsageDescription",
];
const requiredLocalizedKeys = [
  "CFBundleDisplayName",
  "NSMicrophoneUsageDescription",
  "NSLocalNetworkUsageDescription",
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function plistValue(keyPath) {
  try {
    return execFileSync(
      "plutil",
      ["-extract", keyPath, "raw", "-o", "-", infoPlist],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

if (!existsSync(infoPlist)) {
  fail(`Info.plist not found: ${infoPlist}`);
} else {
  for (const key of requiredInfoKeys) {
    if (!plistValue(key)) fail(`Info.plist is missing ${key}.`);
  }
  const allowsLocalNetworking = plistValue(
    "NSAppTransportSecurity.NSAllowsLocalNetworking",
  );
  if (!["true", "1"].includes(allowsLocalNetworking)) {
    fail("Info.plist must set NSAppTransportSecurity.NSAllowsLocalNetworking=true.");
  }
}

for (const file of localizedFiles) {
  if (!existsSync(file)) {
    fail(`Localized InfoPlist.strings not found: ${file}`);
    continue;
  }
  const content = readFileSync(file, "utf8");
  for (const key of requiredLocalizedKeys) {
    if (!new RegExp(`"${key}"\\s*=`).test(content)) {
      fail(`${file} is missing ${key}.`);
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log("iOS runtime permission metadata is ready.");
