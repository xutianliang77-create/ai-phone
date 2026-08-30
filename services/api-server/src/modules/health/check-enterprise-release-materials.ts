import { execFileSync } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";
import { getEnterpriseReleaseMaterialsReadinessForFile } from
  "./enterprise-release-materials-readiness.js";

const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const file = valueFlag("--file") ?? process.env.ENTERPRISE_RELEASE_MATERIALS_FILE;
const commitSha = valueFlag("--commit") ?? currentCommit();
const imageDigest = valueFlag("--image-digest") ??
  process.env.ENTERPRISE_RELEASE_IMAGE_DIGEST;

if (help || args.length > 0 || !file || !imageDigest) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = getEnterpriseReleaseMaterialsReadinessForFile(resolve(file), {
  repositoryRoot: process.cwd(),
  expectedCommitSha: commitSha,
  expectedImageDigest: imageDigest,
});

if (json) console.log(JSON.stringify(result, null, 2));
else if (result.status === "ready") console.log("Enterprise release materials readiness passed.");
else console.error(`Enterprise release materials readiness failed: ${result.issues.join("; ")}`);

if (result.status !== "ready") process.exit(1);

function takeFlag(flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

function usage() {
  console.log(`Usage:
  npm run check:enterprise-release-materials -- --file <manifest.json> --image-digest sha256:<64-hex>

The manifest must bind the current commit and image digest, approved enterprise documents,
A0-A3/H1-H3 evidence files with exact SHA-256, and six independent approvals.`);
}
