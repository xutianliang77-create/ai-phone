#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidence = valueFlag("--evidence");
if (!evidence) fail("Usage: --evidence=<signed-penetration-result.json>");
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) {
  fail("Enterprise security release gate requires a clean candidate worktree");
}
const checks = [
  ["static", "scripts/check_enterprise_security_static.mjs", []],
  ["dependency", "scripts/check_dependency_security.mjs", []],
  ["penetration", "scripts/check_enterprise_security_penetration.mjs", [`--evidence=${evidence}`]],
];
for (const [name, script, args] of checks) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`Enterprise security ${name} gate failed`);
  }
}
console.log(JSON.stringify({
  status: "pass",
  gate: "enterprise_release_security",
  checks: checks.map(([name]) => name),
}, null, 2));

function valueFlag(name) {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
function fail(message) { console.error(message); process.exit(1); }
