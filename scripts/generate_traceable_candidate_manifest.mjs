import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateWipInventory } from "./generate_wujie_wip_inventory.mjs";

function command(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function optionalCommand(cwd, args) {
  try {
    return command(cwd, args);
  } catch {
    return undefined;
  }
}

function isSecretOrEvidencePath(path) {
  const name = basename(path).toLowerCase();
  return path.startsWith("outputs/") || path.startsWith(".cache/") ||
    name === ".env" || name.startsWith(".env.") || name.endsWith(".pem") ||
    name.endsWith(".p12") || name.endsWith(".key") ||
    name.endsWith(".mobileprovision") || path === "release/domestic/release.env";
}

function untrackedFingerprint(cwd, inventory) {
  const records = [];
  let excluded = 0;
  for (const group of Object.values(inventory.groups)) {
    for (const entry of group.paths) {
      if (entry.status !== "??") continue;
      if (isSecretOrEvidencePath(entry.path)) {
        excluded += 1;
        continue;
      }
      const fullPath = resolve(cwd, entry.path);
      if (!existsSync(fullPath)) continue;
      records.push(`${entry.path}\0${sha256(readFileSync(fullPath))}`);
    }
  }
  records.sort();
  return {
    count: records.length,
    excluded,
    sha256: sha256(records.join("\n")),
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

export function buildCandidateManifest({
  cwd = process.cwd(),
  candidateId,
  runtimeContractPath = "release/domestic/wujie-v1-runtime-contract.json",
  runtimeEvidencePath,
  mobileEvidencePath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const inventory = generateWipInventory({ cwd, generatedAt });
  const head = command(cwd, ["rev-parse", "HEAD"]);
  const upstream = optionalCommand(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const divergence = upstream
    ? command(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
      .split(/\s+/).map(Number)
    : undefined;
  const trackedDiff = execFileSync(
    "git",
    ["diff", "--binary", "--", ".", ":(exclude)outputs/**", ":(exclude)PROGRESS_LOG.md"],
    { cwd, maxBuffer: 64 * 1024 * 1024 },
  );
  const stagedDiff = execFileSync(
    "git",
    ["diff", "--cached", "--binary", "--", ".", ":(exclude)outputs/**"],
    { cwd, maxBuffer: 64 * 1024 * 1024 },
  );
  const contractFullPath = resolve(cwd, runtimeContractPath);
  const runtimeEvidence = runtimeEvidencePath
    ? JSON.parse(readFileSync(resolve(cwd, runtimeEvidencePath), "utf8"))
    : undefined;
  const mobileEvidence = mobileEvidencePath
    ? JSON.parse(readFileSync(resolve(cwd, mobileEvidencePath), "utf8"))
    : undefined;
  const sourceDirty = inventory.tracked > 0 ||
    inventory.untracked > inventory.outputsExcludedFromCandidates;
  const runtimeTraceable = Boolean(
    runtimeEvidence?.deployment?.imageId && runtimeEvidence?.deployment?.configSha256,
  );
  const mobileTraceable = Boolean(
    mobileEvidence?.sourceCommit && mobileEvidence?.sourceTree,
  );

  return {
    schemaVersion: 1,
    candidateId: candidateId ?? `wujie-v1-${head.slice(0, 7)}-${generatedAt.replace(/\D/g, "").slice(0, 14)}`,
    generatedAt,
    source: {
      branch: command(cwd, ["branch", "--show-current"]),
      head,
      tree: command(cwd, ["rev-parse", "HEAD^{tree}"]),
      upstream,
      ahead: divergence?.[1],
      behind: divergence?.[0],
      dirty: sourceDirty,
      trackedChanged: inventory.tracked,
      untracked: inventory.untracked,
      outputsExcluded: inventory.outputsExcludedFromCandidates,
      trackedDiffSha256: sha256(trackedDiff),
      stagedDiffSha256: sha256(stagedDiff),
      untrackedSource: untrackedFingerprint(cwd, inventory),
    },
    runtimeContract: {
      path: runtimeContractPath,
      sha256: sha256(readFileSync(contractFullPath)),
    },
    ...(runtimeEvidence ? { runtimeEvidence } : {}),
    ...(mobileEvidence ? { mobileEvidence } : {}),
    eligibility: {
      traceable: runtimeTraceable && mobileTraceable,
      productionEligible: !sourceDirty && runtimeEvidence?.releaseReady === true &&
        mobileEvidence?.compatible === true && runtimeTraceable && mobileTraceable,
      reasons: [
        ...(sourceDirty ? ["source_worktree_is_dirty"] : []),
        ...(!runtimeEvidence ? ["runtime_evidence_missing"] : []),
        ...(!mobileEvidence ? ["mobile_evidence_missing"] : []),
        ...(runtimeEvidence && !runtimeTraceable ? ["runtime_deployment_identity_missing"] : []),
        ...(mobileEvidence && !mobileTraceable ? ["mobile_source_identity_missing"] : []),
        ...(runtimeEvidence && runtimeEvidence.releaseReady !== true
          ? ["runtime_release_gate_not_ready"] : []),
        ...(mobileEvidence && mobileEvidence.compatible !== true
          ? ["mobile_candidate_not_compatible"] : []),
      ],
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) throw new Error("--output is required");
  const manifest = buildCandidateManifest({
    candidateId: args["candidate-id"],
    runtimeContractPath: args["runtime-contract"],
    runtimeEvidencePath: args["runtime-evidence"],
    mobileEvidencePath: args["mobile-evidence"],
  });
  const output = resolve(args.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}
