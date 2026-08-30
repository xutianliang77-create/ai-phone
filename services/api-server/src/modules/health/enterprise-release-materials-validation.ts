import {
  ENTERPRISE_RELEASE_APPROVAL_ROLES,
  ENTERPRISE_RELEASE_ARTIFACT_KINDS,
  ENTERPRISE_RELEASE_GATES,
  type EnterpriseReleaseMaterialsManifest,
} from "./enterprise-release-materials-schema.js";
import {
  isCommitSha,
  isImageDigest,
  isText,
  isTimestamp,
  releaseFileIssues,
} from "./enterprise-release-materials-files.js";

export function enterpriseReleaseManifestIssues(input: {
  manifest: EnterpriseReleaseMaterialsManifest;
  repositoryRoot: string;
  expectedCommitSha?: string;
  expectedImageDigest?: string;
}) {
  const { manifest } = input;
  return [
    ...identityIssues(manifest, input.expectedCommitSha, input.expectedImageDigest),
    ...artifactIssues(manifest, input.repositoryRoot),
    ...gateIssues(manifest, input.repositoryRoot),
    ...approvalIssues(manifest),
  ];
}

function identityIssues(
  manifest: EnterpriseReleaseMaterialsManifest,
  expectedCommitSha?: string,
  expectedImageDigest?: string,
) {
  const issues: string[] = [];
  if (manifest.schemaVersion !== 1) issues.push("enterprise release unsupported schemaVersion");
  if (manifest.product !== "ai-phone-enterprise") issues.push("enterprise release invalid product");
  if (!isText(manifest.releaseId)) issues.push("enterprise release invalid releaseId");
  if (!isText(manifest.version)) issues.push("enterprise release invalid version");
  if (!isTimestamp(manifest.generatedAt)) issues.push("enterprise release invalid generatedAt");
  if (!manifest.candidate || !isCommitSha(manifest.candidate.commitSha)) {
    issues.push("enterprise release invalid candidate commitSha");
  }
  if (!manifest.candidate || !isImageDigest(manifest.candidate.imageDigest)) {
    issues.push("enterprise release invalid candidate imageDigest");
  }
  if (expectedCommitSha && manifest.candidate?.commitSha !== expectedCommitSha) {
    issues.push("enterprise release candidate commitSha mismatch");
  }
  if (expectedImageDigest && manifest.candidate?.imageDigest !== expectedImageDigest) {
    issues.push("enterprise release candidate imageDigest mismatch");
  }
  return issues;
}

function artifactIssues(
  manifest: EnterpriseReleaseMaterialsManifest,
  repositoryRoot: string,
) {
  if (!Array.isArray(manifest.artifacts)) {
    return ["enterprise release missing artifacts"];
  }
  const issues: string[] = [];
  const paths = manifest.artifacts.map((item) => item?.path)
    .filter((path): path is string => typeof path === "string");
  if (new Set(paths).size !== paths.length) {
    issues.push("enterprise release artifact paths must be unique");
  }
  for (const kind of ENTERPRISE_RELEASE_ARTIFACT_KINDS) {
    const matches = manifest.artifacts.filter((item) => item?.kind === kind);
    if (matches.length !== 1) {
      issues.push(`enterprise release requires exactly one ${kind} artifact`);
      continue;
    }
    const artifact = matches[0];
    const label = `enterprise release ${kind}`;
    if (artifact.status !== "approved") issues.push(`${label} is not approved`);
    if (!isText(artifact.approvedBy)) issues.push(`${label} missing approver`);
    if (!isTimestamp(artifact.approvedAt)) issues.push(`${label} invalid approvedAt`);
    issues.push(...releaseFileIssues({
      label,
      path: artifact.path,
      sha256: artifact.sha256,
      repositoryRoot,
      rejectDraftMarkers: artifact.status === "approved",
    }));
  }
  const known = new Set<string>(ENTERPRISE_RELEASE_ARTIFACT_KINDS);
  if (manifest.artifacts.some((item) => !known.has(String(item?.kind)))) {
    issues.push("enterprise release contains unknown artifact kind");
  }
  return issues;
}

function gateIssues(
  manifest: EnterpriseReleaseMaterialsManifest,
  repositoryRoot: string,
) {
  if (!Array.isArray(manifest.gateEvidence)) {
    return ["enterprise release missing gate evidence"];
  }
  const issues: string[] = [];
  for (const gate of ENTERPRISE_RELEASE_GATES) {
    const matches = manifest.gateEvidence.filter((item) => item?.gate === gate);
    if (matches.length !== 1) {
      issues.push(`enterprise release requires exactly one ${gate} gate evidence`);
      continue;
    }
    const evidence = matches[0];
    const label = `enterprise release ${gate} gate`;
    if (evidence.status !== "passed") issues.push(`${label} is not passed`);
    if (!Array.isArray(evidence.acceptanceIds) || evidence.acceptanceIds.length === 0 ||
      evidence.acceptanceIds.some((id) => !isText(id))) {
      issues.push(`${label} missing acceptanceIds`);
    }
    if (evidence.commitSha !== manifest.candidate?.commitSha) {
      issues.push(`${label} commitSha mismatch`);
    }
    if (evidence.imageDigest !== manifest.candidate?.imageDigest) {
      issues.push(`${label} imageDigest mismatch`);
    }
    if (!isText(evidence.reviewer)) issues.push(`${label} missing reviewer`);
    if (!isTimestamp(evidence.verifiedAt)) issues.push(`${label} invalid verifiedAt`);
    issues.push(...releaseFileIssues({
      label,
      path: evidence.evidencePath,
      sha256: evidence.evidenceSha256,
      repositoryRoot,
      rejectDraftMarkers: evidence.status === "passed",
    }));
  }
  const known = new Set<string>(ENTERPRISE_RELEASE_GATES);
  if (manifest.gateEvidence.some((item) => !known.has(String(item?.gate)))) {
    issues.push("enterprise release contains unknown gate evidence");
  }
  return issues;
}

function approvalIssues(manifest: EnterpriseReleaseMaterialsManifest) {
  if (!Array.isArray(manifest.approvals)) {
    return ["enterprise release missing approvals"];
  }
  const issues: string[] = [];
  for (const role of ENTERPRISE_RELEASE_APPROVAL_ROLES) {
    const matches = manifest.approvals.filter((item) => item?.role === role);
    if (matches.length !== 1) {
      issues.push(`enterprise release requires exactly one ${role} approval`);
      continue;
    }
    const approval = matches[0];
    if (approval.status !== "approved") {
      issues.push(`enterprise release ${role} approval is not approved`);
    }
    if (!isText(approval.approver)) {
      issues.push(`enterprise release ${role} approval missing approver`);
    }
    if (!isTimestamp(approval.approvedAt)) {
      issues.push(`enterprise release ${role} approval invalid approvedAt`);
    }
  }
  const known = new Set<string>(ENTERPRISE_RELEASE_APPROVAL_ROLES);
  if (manifest.approvals.some((item) => !known.has(String(item?.role)))) {
    issues.push("enterprise release contains unknown approval role");
  }
  return issues;
}
