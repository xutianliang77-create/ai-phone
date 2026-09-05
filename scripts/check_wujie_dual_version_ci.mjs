#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateWujieDualVersionCi } from "./lib/wujie_dual_version_ci_policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "898ee517e7aac00b03bc79ff2d0597dd00fdbf56";
const run = (args) => spawnSync("git", args, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
const required = (args, label) => {
  const result = run(args);
  if (result.status !== 0) {
    throw new Error(`${label}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
};
const exists = run(["cat-file", "-e", `${base}^{commit}`]).status === 0;
const ancestor = run(["merge-base", "--is-ancestor", base, "HEAD"]).status === 0;
const baseTree = exists
  ? required(["rev-parse", `${base}^{tree}`], "read frozen tree").trim()
  : null;
const basePubspec = exists
  ? required(["show", `${base}:apps/mobile/pubspec.yaml`], "read frozen mobile version")
  : "";
const version = basePubspec.match(/^version:\s*(\S+)\s*$/m)?.[1] ?? null;
const trackedPaths = required([
  "ls-files", "-z", "--cached", "--others", "--exclude-standard",
], "list versioned candidate files")
  .split("\0").filter(Boolean);

const result = evaluateWujieDualVersionCi({
  manifest: JSON.parse(read("release/public/1.1.0/development-line.json")),
  workflow: read(".github/workflows/wujie-dual-version.yml"),
  ciWorkflow: read(".github/workflows/ci.yml"),
  supplyChainWorkflow: read(".github/workflows/supply-chain.yml"),
  gitignore: read(".gitignore"),
  trackedPaths,
  gitFacts: {
    baseCommitExists: exists,
    baseTree,
    headDescendsFromBase: ancestor,
    baseMobileVersion: version,
  },
});

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (result.status === "ready") {
  process.stdout.write(`Wujie dual-version CI policy passed (${result.summary.passed}/${result.summary.checks}).\n`);
} else {
  process.stderr.write(`Wujie dual-version CI policy failed:\n- ${result.issues.join("\n- ")}\n`);
}
if (result.status !== "ready") process.exitCode = 1;

function read(relative) {
  return readFileSync(path.join(root, relative), "utf8");
}
