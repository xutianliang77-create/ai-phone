#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");
const profileDir = path.resolve(
  valueFlag("--profile-dir") ??
    path.join(os.homedir(), "Library/MobileDevice/Provisioning Profiles"),
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const signing = loadSigningSettings();
const device = loadDeviceDiagnostic();
const profiles = loadProfiles(profileDir);
const evaluation = evaluateProfiles({
  profiles,
  teamId: signing.settings?.developmentTeam ?? "",
  bundleId: signing.settings?.productBundleIdentifier ?? "",
  udid: selectedUdid(device),
});
const issues = profileIssues({ signing, device, profiles, evaluation });
const payload = {
  schemaVersion: 1,
  status: issues.length === 0 ? "ready" : "not_ready",
  profileDir,
  requested: {
    teamId: signing.settings?.developmentTeam ?? "",
    bundleId: signing.settings?.productBundleIdentifier ?? "",
    deviceId: process.env.DEVICE_ID || null,
    udid: selectedUdid(device),
  },
  signingStatus: signing.status ?? "unknown",
  deviceStatus: device.ready === true ? "ready" : "not_ready",
  profileCount: profiles.length,
  candidateCount: evaluation.candidates.length,
  matchingProfiles: evaluation.matches,
  closestProfiles: evaluation.candidates.slice(0, 5),
  issues,
  actions: profileActions(issues, signing, device),
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (issues.length > 0) {
  console.error(issues.join("\n"));
  for (const action of payload.actions) console.error(`action: ${action}`);
} else {
  const profile = payload.matchingProfiles[0];
  console.log(
    `iOS provisioning profile is ready: ${profile.name}; uuid=${profile.uuid}`,
  );
}

if (issues.length > 0) process.exit(1);

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

function loadSigningSettings() {
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts/check_ios_signing_settings.mjs"),
    "--json",
  ], { cwd: root, encoding: "utf8" });
  const payload = parseJson(result.stdout);
  return payload ?? { status: "unknown", settings: {}, failures: [] };
}

function loadDeviceDiagnostic() {
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts/diagnose_ios_device.mjs"),
    "--require-ready",
    "--json",
  ], { cwd: root, encoding: "utf8", env: process.env });
  return parseJson(result.stdout) ?? {
    ready: false,
    requestedDevice: process.env.DEVICE_ID || null,
    devices: [],
    error: result.stderr.trim() || null,
  };
}

function loadProfiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".mobileprovision"))
    .map((entry) => path.join(dir, entry))
    .map(decodeProfile)
    .filter(Boolean);
}

function decodeProfile(file) {
  try {
    const xml = execFileSync("security", ["cms", "-D", "-i", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const jsonText = execFileSync("plutil", ["-convert", "json", "-o", "-", "--", "-"], {
      encoding: "utf8",
      input: xml,
    });
    return summarizeProfile(file, JSON.parse(jsonText));
  } catch {
    return null;
  }
}

function summarizeProfile(file, profile) {
  const entitlements = profile.Entitlements ?? {};
  return {
    path: file,
    name: profile.Name ?? "",
    uuid: profile.UUID ?? path.basename(file, ".mobileprovision"),
    teamIds: profile.TeamIdentifier ?? [],
    applicationIdentifier: entitlements["application-identifier"] ?? "",
    teamIdentifier: entitlements["com.apple.developer.team-identifier"] ?? "",
    provisionedDevices: profile.ProvisionedDevices ?? [],
    expirationDate: profile.ExpirationDate ?? null,
  };
}

function evaluateProfiles({ profiles, teamId, bundleId, udid }) {
  const now = Date.now();
  const candidates = profiles.map((profile) => {
    const checks = profileChecks(profile, { teamId, bundleId, udid, now });
    return { ...profile, checks };
  });
  const matches = candidates.filter((profile) => {
    return Object.values(profile.checks).every(Boolean);
  });
  return { candidates, matches };
}

function profileChecks(profile, { teamId, bundleId, udid, now }) {
  return {
    team: teamMatches(profile, teamId),
    bundle: bundleMatches(profile.applicationIdentifier, teamId, bundleId),
    device: Boolean(udid) && profile.provisionedDevices.includes(udid),
    unexpired: !profile.expirationDate ||
      Date.parse(profile.expirationDate) > now,
  };
}

function teamMatches(profile, teamId) {
  if (!teamId) return false;
  return profile.teamIdentifier === teamId || profile.teamIds.includes(teamId);
}

function bundleMatches(applicationIdentifier, teamId, bundleId) {
  if (!applicationIdentifier || !teamId || !bundleId) return false;
  const prefix = `${teamId}.`;
  if (!applicationIdentifier.startsWith(prefix)) return false;
  const pattern = applicationIdentifier.slice(prefix.length);
  return pattern === bundleId ||
    (pattern.endsWith(".*") && bundleId.startsWith(pattern.slice(0, -1)));
}

function profileIssues({ signing, device, profiles, evaluation }) {
  const issues = [];
  const requestedTeam = signing.settings?.developmentTeam ?? "";
  const requestedBundle = signing.settings?.productBundleIdentifier ?? "";
  const udid = selectedUdid(device);
  if (signing.status !== "ready") {
    issues.push("iOS signing settings are not ready.");
  }
  if (!requestedTeam || !requestedBundle) {
    issues.push("Missing team id or bundle id from Xcode signing settings.");
  }
  if (!udid) {
    issues.push("No matching physical iPhone UDID is available from devicectl.");
  }
  if (profiles.length === 0) {
    issues.push("No local iOS provisioning profiles were found.");
    return issues;
  }
  if (evaluation.matches.length === 0) {
    issues.push(
      `No unexpired local development profile matches team=${requestedTeam}, bundle=${requestedBundle}, device=${udid || "unknown"}.`,
    );
  }
  return issues;
}

function profileActions(issues, signing, device) {
  const actions = [];
  if (issues.some((issue) => issue.includes("signing settings"))) {
    actions.push("Open apps/mobile/ios/Runner.xcworkspace and confirm Automatic Signing, Team, and Bundle Identifier.");
  }
  if (device.ready !== true) {
    actions.push("Enable iOS Developer Mode, keep the iPhone unlocked, connected, and trusted, then rerun the status check.");
  }
  if (issues.some((issue) => issue.includes("No local iOS provisioning profiles"))) {
    actions.push("After the iPhone is ready, let Xcode register the device and create an iOS App Development provisioning profile.");
  }
  if (issues.some((issue) => issue.startsWith("No unexpired local"))) {
    actions.push("Regenerate the iOS App Development provisioning profile for the current Team, Bundle Identifier, and iPhone UDID.");
  }
  return Array.from(new Set(actions));
}

function selectedUdid(device) {
  const devices = device.devices ?? [];
  const matched = devices.find((item) => item.matched !== false) ?? devices[0];
  return matched?.udid && matched.udid !== "unknown" ? matched.udid : null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function usage() {
  console.log(`Usage:
  scripts/check_ios_provisioning_profile.mjs [--json]
  scripts/check_ios_provisioning_profile.mjs [--profile-dir PATH]

Checks local iOS development provisioning profiles against the Runner Team,
Bundle Identifier, and selected physical iPhone UDID.`);
}
