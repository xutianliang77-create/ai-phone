#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredImageNames = ["server", "sip", "egress", "ingress"];

export function liveKitSbomPlan(profile) {
  const include = [];
  const missing = [];
  for (const name of requiredImageNames) {
    const image = profile.images?.[name];
    if (!isPinnedImage(image)) {
      missing.push(name);
      continue;
    }
    include.push({
      name,
      image: `${image.repository}:${image.tag}@${image.digest}`,
      platform: image.platform,
      status: image.status,
    });
  }
  return {
    schemaVersion: 1,
    matrix: { include },
    missing,
    complete: missing.length === 0,
  };
}

function isPinnedImage(image) {
  return image &&
    /^[a-z0-9._/-]+$/i.test(image.repository ?? "") &&
    /^[a-z0-9._-]+$/i.test(image.tag ?? "") &&
    /^sha256:[a-f0-9]{64}$/.test(image.digest ?? "") &&
    ["linux/amd64", "linux/arm64"].includes(image.platform);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const profileArg = valueFlag(args, "--profile");
  const profileFile = path.resolve(
    root,
    profileArg ?? "infra/livekit-compatibility-profile.json",
  );
  const plan = liveKitSbomPlan(JSON.parse(readFileSync(profileFile, "utf8")));
  if (args.includes("--matrix")) {
    process.stdout.write(JSON.stringify(plan.matrix));
  } else {
    process.stdout.write(`${JSON.stringify({ profileFile, ...plan }, null, 2)}\n`);
  }
  if (args.includes("--require-all") && !plan.complete) process.exitCode = 1;
}

function valueFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}
