import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ENTERPRISE_RELEASE_CHECKED_ITEMS,
  type EnterpriseReleaseMaterialsManifest,
} from "./enterprise-release-materials-schema.js";
import { enterpriseReleaseManifestIssues } from
  "./enterprise-release-materials-validation.js";

export interface EnterpriseReleaseMaterialsReadinessOptions {
  repositoryRoot?: string;
  expectedCommitSha?: string;
  expectedImageDigest?: string;
}

export function getEnterpriseReleaseMaterialsReadiness() {
  const manifestPath = process.env.ENTERPRISE_RELEASE_MATERIALS_FILE?.trim();
  if (!manifestPath) {
    return notReady([
      "enterprise release materials missing ENTERPRISE_RELEASE_MATERIALS_FILE",
    ]);
  }
  const expectedCommitSha = process.env.ENTERPRISE_RELEASE_CANDIDATE_COMMIT?.trim();
  const expectedImageDigest = process.env.ENTERPRISE_RELEASE_IMAGE_DIGEST?.trim();
  if (!expectedCommitSha || !expectedImageDigest) {
    return notReady([
      ...(!expectedCommitSha
        ? ["enterprise release materials missing ENTERPRISE_RELEASE_CANDIDATE_COMMIT"]
        : []),
      ...(!expectedImageDigest
        ? ["enterprise release materials missing ENTERPRISE_RELEASE_IMAGE_DIGEST"]
        : []),
    ]);
  }
  const options: EnterpriseReleaseMaterialsReadinessOptions = {};
  if (process.env.ENTERPRISE_RELEASE_REPOSITORY_ROOT?.trim()) {
    options.repositoryRoot = process.env.ENTERPRISE_RELEASE_REPOSITORY_ROOT.trim();
  }
  options.expectedCommitSha = expectedCommitSha;
  options.expectedImageDigest = expectedImageDigest;
  return getEnterpriseReleaseMaterialsReadinessForFile(manifestPath, options);
}

export function getEnterpriseReleaseMaterialsReadinessForFile(
  manifestPath: string,
  options: EnterpriseReleaseMaterialsReadinessOptions = {},
) {
  const loaded = loadManifest(manifestPath);
  if (!loaded.ok) return notReady([loaded.issue]);
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const issues = enterpriseReleaseManifestIssues({
    manifest: loaded.manifest,
    repositoryRoot,
    ...(options.expectedCommitSha
      ? { expectedCommitSha: options.expectedCommitSha }
      : {}),
    ...(options.expectedImageDigest
      ? { expectedImageDigest: options.expectedImageDigest }
      : {}),
  });
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    releaseId: loaded.manifest.releaseId,
    candidate: loaded.manifest.candidate,
    checkedItems: [...ENTERPRISE_RELEASE_CHECKED_ITEMS],
    issues,
    warnings: [],
  };
}

function loadManifest(manifestPath: string) {
  try {
    const parsed = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false as const, issue: "enterprise release invalid manifest" };
    }
    return {
      ok: true as const,
      manifest: parsed as EnterpriseReleaseMaterialsManifest,
    };
  } catch {
    return { ok: false as const, issue: "enterprise release unreadable manifest" };
  }
}

function notReady(issues: string[]) {
  return {
    status: "not_ready" as const,
    checkedItems: [...ENTERPRISE_RELEASE_CHECKED_ITEMS],
    issues,
    warnings: [],
  };
}
