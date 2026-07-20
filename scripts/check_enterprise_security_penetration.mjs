#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { verifyPenetrationEvidence } from "./lib/enterprise_security_penetration.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceFile = valueFlag("--evidence");
if (!evidenceFile) {
  console.error("Usage: --evidence=<signed-penetration-result.json>");
  process.exit(1);
}
const result = verifyPenetrationEvidence({
  evidence: readJson(path.resolve(root, evidenceFile)),
  policy: readJson(path.join(root, "infra/enterprise-security/security-gate-policy.json")),
  expectedCommitSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root, encoding: "utf8",
  }).trim(),
  signingKey: process.env.ENTERPRISE_SECURITY_EVIDENCE_SIGNING_KEY,
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== "pass") process.exit(1);

function valueFlag(name) {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
