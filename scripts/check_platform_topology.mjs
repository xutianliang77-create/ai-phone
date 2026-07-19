#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkPlatformTopology } from "./lib/platform_topology_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = takeFlag("--json");
const release = takeFlag("--release");
const file = valueFlag("--file");
if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
const result = checkPlatformTopology({ root, file, release });
if (json) console.log(JSON.stringify(result, null, 2));
else if (result.status === "ready") console.log(`Platform topology ready: ${result.file}`);
else console.error(`Platform topology not ready: ${result.issues.join("; ")}`);
if (result.status !== "ready") process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}
