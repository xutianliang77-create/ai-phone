#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { scanEnterpriseStaticSecurity } from "./lib/enterprise_security_static.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const policy = JSON.parse(readFileSync(
  path.join(root, "infra/enterprise-security/security-gate-policy.json"),
  "utf8",
));
const inputIssues = [];
let binaryFilesSkipped = 0;
const files = [];
for (const relative of repositoryFiles()) {
  try {
    const value = readFileSync(path.join(root, relative));
    if (value.includes(0)) {
      binaryFilesSkipped += 1;
      continue;
    }
    files.push({ path: relative, content: value.toString("utf8") });
  } catch {
    inputIssues.push(`Unable to read repository file: ${relative}`);
  }
}
const result = {
  ...scanEnterpriseStaticSecurity({ files, policy, inputIssues }),
  commitSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root, encoding: "utf8",
  }).trim(),
  binaryFilesSkipped,
};
console.log(JSON.stringify(result, null, 2));
if (result.status !== "pass") process.exit(1);

function repositoryFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  ).split("\0").filter(Boolean).sort();
}
