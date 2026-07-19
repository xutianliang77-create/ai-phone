#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkLiveKitCompatibilityProfile } from "./lib/livekit_compatibility_profile.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const release = takeFlag("--release");
const json = takeFlag("--json");
const profileFile = valueFlag("--profile");
if (args.length > 0) {
  console.error(`Unknown arguments: ${args.join(" ")}`);
  process.exit(1);
}

const result = checkLiveKitCompatibilityProfile({
  root,
  profileFile,
  release,
});
if (json) console.log(JSON.stringify(result, null, 2));
else if (result.status === "ready") {
  console.log(`LiveKit compatibility profile passed: ${result.profileFile}`);
} else {
  console.error(`LiveKit compatibility profile failed: ${result.issues.join("; ")}`);
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
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}
