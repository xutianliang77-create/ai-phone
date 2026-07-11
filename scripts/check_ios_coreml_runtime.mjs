#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const minIos = 17;
const fluidAudioRevision = "9c20d9bccc1fa5a0b9890b088167c80ee2d6d913";
const pbxprojPath = path.join(root, "apps/mobile/ios/Runner.xcodeproj/project.pbxproj");
const builtAppPath = path.resolve(
  root,
  process.argv[2] ?? "apps/mobile/build/ios/iphoneos/Runner.app",
);

const failures = [];
checkPbxproj();
checkPackageResolved();
checkBuiltAppIfPresent();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("iOS CoreML/Nemotron runtime settings are ready.");

function checkPbxproj() {
  if (!existsSync(pbxprojPath)) {
    failures.push(`Xcode project not found: ${pbxprojPath}`);
    return;
  }
  const project = readFileSync(pbxprojPath, "utf8");
  const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g)]
    .map((match) => Number(match[1]));
  if (targets.length === 0) {
    failures.push("Xcode project is missing IPHONEOS_DEPLOYMENT_TARGET.");
  }
  const tooLow = targets.filter((value) => value < minIos);
  if (tooLow.length > 0) {
    failures.push(`IPHONEOS_DEPLOYMENT_TARGET must be >= ${minIos}.0.`);
  }
  if (!project.includes("FluidAudio in Frameworks")) {
    failures.push("Runner target is missing FluidAudio in Frameworks.");
  }
  if (!project.includes("productName = FluidAudio;")) {
    failures.push("Runner target is missing FluidAudio product dependency.");
  }
  if (!project.includes("https://github.com/FluidInference/FluidAudio.git")) {
    failures.push("Xcode project is missing the FluidAudio Swift package URL.");
  }
  if (!project.includes(fluidAudioRevision)) {
    failures.push("Xcode project FluidAudio revision is not the expected pin.");
  }
}

function checkPackageResolved() {
  const resolvedFiles = [
    "apps/mobile/ios/Runner.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
    "apps/mobile/ios/Runner.xcworkspace/xcshareddata/swiftpm/Package.resolved",
  ].map((item) => path.join(root, item));
  const existing = resolvedFiles.filter(existsSync);
  if (existing.length === 0) {
    failures.push("FluidAudio Package.resolved pin is missing.");
    return;
  }
  for (const file of existing) {
    const content = readFileSync(file, "utf8");
    if (!content.includes('"identity" : "fluidaudio"')) {
      failures.push(`${file} is missing the FluidAudio pin.`);
    }
    if (!content.includes(fluidAudioRevision)) {
      failures.push(`${file} is not pinned to the expected FluidAudio revision.`);
    }
  }
}

function checkBuiltAppIfPresent() {
  const infoPlist = path.join(builtAppPath, "Info.plist");
  if (!existsSync(infoPlist)) return;
  const minimumOs = plistValue(infoPlist, "MinimumOSVersion");
  if (Number(minimumOs) < minIos) {
    failures.push(`Built app MinimumOSVersion must be >= ${minIos}.0.`);
  }
  const capabilities = plistJson(infoPlist, "UIRequiredDeviceCapabilities");
  if (!Array.isArray(capabilities) || !capabilities.includes("arm64")) {
    failures.push("Built app must require arm64 for CoreML/Nemotron.");
  }
}

function plistValue(file, keyPath) {
  try {
    return execFileSync("plutil", ["-extract", keyPath, "raw", "-o", "-", file], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function plistJson(file, keyPath) {
  try {
    const output = execFileSync("plutil", ["-extract", keyPath, "json", "-o", "-", file], {
      encoding: "utf8",
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}
