const expected = {
  branch: "develop/wujie-1.1-public",
  baseCommit: "898ee517e7aac00b03bc79ff2d0597dd00fdbf56",
  baseTree: "5c564f99489f7bd62eae28ef75157f6e77a2c369",
  baseMobileVersion: "1.0.0+2026090501",
  nodeVersion: "24",
  flutterVersion: "3.44.1",
};

export function evaluateWujieDualVersionCi(input) {
  const checks = [];
  const issues = [];
  const record = (name, ok, detail) => {
    checks.push({ name, status: ok ? "pass" : "fail", detail });
    if (!ok) issues.push(`${name}: ${detail}`);
  };
  const { manifest, workflow, ciWorkflow, supplyChainWorkflow } = input;

  record("manifest_status", manifest.status === "development_line",
    `expected development_line, got ${manifest.status}`);
  record("target_version", manifest.targetProductVersion === "1.1.0",
    `expected 1.1.0, got ${manifest.targetProductVersion}`);
  record("development_branch", manifest.branch === expected.branch,
    `expected ${expected.branch}, got ${manifest.branch}`);
  record("frozen_10_commit", manifest.createdFrom?.commit === expected.baseCommit,
    `expected ${expected.baseCommit}, got ${manifest.createdFrom?.commit}`);
  record("frozen_10_tree", manifest.createdFrom?.tree === expected.baseTree,
    `expected ${expected.baseTree}, got ${manifest.createdFrom?.tree}`);
  record("release_identity_deferred", manifest.versionIdentity?.freezeTask === "V11-03"
    && manifest.versionIdentity?.public11ReleaseVersionFrozen === false
    && manifest.versionIdentity?.public11ApplicationIdentityFrozen === false,
  "V11-01 must leave public release identity to V11-03");
  record("ci_secrets_forbidden", manifest.isolation?.productionSecretsAllowedInCi === false,
    "productionSecretsAllowedInCi must be false");
  record("ci_data_forbidden", manifest.isolation?.productionDataAllowedInCi === false,
    "productionDataAllowedInCi must be false");
  record("private_inputs_not_imported", manifest.isolation?.private10DataImported === false
    && manifest.isolation?.private10CredentialsImported === false,
  "private 1.0 data and credentials must not be imported");
  record("public_runtime_not_claimed", manifest.scope?.publicCloudRuntimeImplemented === false
    && manifest.scope?.providerCallsEnabled === false
    && manifest.scope?.deploymentPerformed === false,
  "V11-01 must not claim public runtime, provider calls, or deployment");

  const ignorePatterns = parseGitignore(input.gitignore);
  for (const pattern of manifest.isolation?.requiredIgnorePatterns ?? []) {
    const present = ignorePatterns.includes(normalize(pattern));
    record(`gitignore:${pattern}`, present,
      present ? "present" : `missing required ignore pattern ${pattern}`);
  }
  const forbidden = input.trackedPaths.filter((file) =>
    isForbiddenTrackedPath(file, manifest.isolation?.forbiddenTrackedSuffixes ?? []));
  record("tracked_secret_and_data_files", forbidden.length === 0,
    forbidden.length === 0 ? "none" : forbidden.join(", "));

  record("lineage_commit_exists", input.gitFacts.baseCommitExists === true,
    "frozen 1.0 commit must exist in the repository object graph");
  record("lineage_tree", input.gitFacts.baseTree === expected.baseTree,
    `expected ${expected.baseTree}, got ${input.gitFacts.baseTree}`);
  record("lineage_ancestor", input.gitFacts.headDescendsFromBase === true,
    "current 1.1 HEAD must descend from frozen 1.0");
  record("frozen_mobile_version", input.gitFacts.baseMobileVersion === expected.baseMobileVersion,
    `expected ${expected.baseMobileVersion}, got ${input.gitFacts.baseMobileVersion}`);

  for (const job of [
    "public-11-node",
    "private-10-node",
    "public-11-mobile",
    "private-10-mobile",
  ]) {
    const present = workflow.includes(`  ${job}:`);
    record(`workflow_job:${job}`, present, present ? "present" : `missing ${job}`);
  }
  record("workflow_frozen_ref", count(workflow, expected.baseCommit) === 2,
    "frozen 1.0 commit must be the exact ref for Node and Flutter jobs");
  const nodePinned = workflow.includes(`node-version: ${expected.nodeVersion}`);
  const flutterPinned = workflow.includes(`flutter-version: ${expected.flutterVersion}`);
  const readOnly = /permissions:\s*\n\s+contents: read/.test(workflow);
  const noSecrets = !workflow.includes("secrets.");
  const productionInputsDisabled = workflow.includes('WUJIE_ALLOW_PRODUCTION_SECRETS: "false"')
    && workflow.includes('WUJIE_ALLOW_PRODUCTION_DATA: "false"')
    && workflow.includes("WUJIE_CI_DATA_MODE: synthetic_only");
  const credentialsDisabled = count(workflow, "persist-credentials: false") === 4;
  record("workflow_node_version", nodePinned,
    nodePinned ? `Node ${expected.nodeVersion}` : `Node ${expected.nodeVersion} is not pinned`);
  record("workflow_flutter_version", flutterPinned,
    flutterPinned ? `Flutter ${expected.flutterVersion}` : `Flutter ${expected.flutterVersion} is not pinned`);
  record("workflow_read_only", readOnly,
    readOnly ? "contents: read" : "workflow permissions must be contents: read");
  record("workflow_no_secrets", noSecrets,
    noSecrets ? "no GitHub secrets references" : "dual-version workflow must not reference GitHub secrets");
  record("workflow_no_production_inputs", productionInputsDisabled,
    productionInputsDisabled ? "synthetic-only" : "production inputs must be disabled and CI data must be synthetic-only");
  record("workflow_checkout_credentials", credentialsDisabled,
    credentialsDisabled ? "disabled for all checkouts" : "every checkout must disable credential persistence");
  const unpinnedActions = [...workflow.matchAll(/^\s*- uses:\s*([^\s#]+)/gm)]
    .map((match) => match[1])
    .filter((reference) => !/@[0-9a-f]{40}$/.test(reference));
  record("workflow_actions_pinned", unpinnedActions.length === 0,
    unpinnedActions.length === 0 ? "all pinned" : unpinnedActions.join(", "));
  for (const [name, source] of [
    ["ci", ciWorkflow],
    ["supply_chain", supplyChainWorkflow],
  ]) {
    const publicBranch = source.includes("develop/wujie-1.1-public");
    const privateBranch = source.includes("release/wujie-1.0-private");
    record(`${name}_public_11_push`, publicBranch,
      publicBranch ? "configured" : `${name} must run on the public 1.1 development branch`);
    record(`${name}_private_10_push`, privateBranch,
      privateBranch ? "configured" : `${name} must continue on the private 1.0 maintenance branch`);
    record(`${name}_read_only`, /permissions:\s*\n\s+contents: read/.test(source),
      `${name} permissions must be contents: read`);
    record(`${name}_checkout_credentials`,
      count(source, "persist-credentials: false") === count(source, "actions/checkout@"),
      `${name} must disable credential persistence for every checkout`);
    record(`${name}_no_secrets`, !source.includes("secrets."),
      `${name} must not reference GitHub secrets`);
  }

  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "ready" : "not_ready",
    checks,
    issues,
    summary: {
      checks: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      frozen10Commit: expected.baseCommit,
      frozen10Tree: expected.baseTree,
      target11Branch: expected.branch,
      productionSecretsAllowed: false,
      productionDataAllowed: false,
    },
  };
}

export function isForbiddenTrackedPath(file, suffixes) {
  const normalized = normalize(file);
  if (normalized.endsWith(".env.example") || normalized.endsWith("key.properties.example")) {
    return false;
  }
  if (/(^|\/)\.env($|\.)/.test(normalized)) return true;
  if (normalized === "release/public/1.1.0/runtime.env") return true;
  if (normalized.startsWith("release/public/1.1.0/private/")) return true;
  if (normalized.startsWith("release/public/1.1.0/data/")) return true;
  return suffixes.some((suffix) => normalized.toLowerCase().endsWith(suffix));
}

function parseGitignore(source) {
  return source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(normalize);
}

function normalize(value) {
  return String(value).replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function count(source, token) {
  return source.split(token).length - 1;
}
