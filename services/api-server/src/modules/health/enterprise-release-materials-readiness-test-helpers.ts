import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENTERPRISE_RELEASE_APPROVAL_ROLES,
  ENTERPRISE_RELEASE_ARTIFACT_KINDS,
  ENTERPRISE_RELEASE_GATES,
  type EnterpriseReleaseMaterialsManifest,
} from "./enterprise-release-materials-schema.js";

export const enterpriseCandidateCommit = "a".repeat(40);
export const enterpriseCandidateImage = `sha256:${"b".repeat(64)}`;

export function writeReadyEnterpriseManifest(tempDirs: string[]) {
  const root = mkdtempSync(join(tmpdir(), "enterprise-release-"));
  tempDirs.push(root);
  const now = new Date(Date.now() - 1_000).toISOString();
  const artifacts = ENTERPRISE_RELEASE_ARTIFACT_KINDS.map((kind) => {
    const path = `${kind}.md`;
    const content = `# Approved ${kind}\n\nCandidate release material.\n`;
    writeFileSync(join(root, path), content);
    return {
      kind,
      path,
      sha256: hash(content),
      status: "approved" as const,
      approvedBy: `${kind}-reviewer@example.test`,
      approvedAt: now,
    };
  });
  const gateEvidence = ENTERPRISE_RELEASE_GATES.map((gate) => {
    const evidencePath = `gate-${gate}.json`;
    const content = JSON.stringify({ gate, result: "pass" });
    writeFileSync(join(root, evidencePath), content);
    return {
      gate,
      status: "passed" as const,
      acceptanceIds: [`AC-${gate}-001`],
      evidencePath,
      evidenceSha256: hash(content),
      commitSha: enterpriseCandidateCommit,
      imageDigest: enterpriseCandidateImage,
      reviewer: `${gate.toLowerCase()}-reviewer@example.test`,
      verifiedAt: now,
    };
  });
  const manifest: EnterpriseReleaseMaterialsManifest = {
    schemaVersion: 1,
    product: "ai-phone-enterprise",
    releaseId: "enterprise-candidate-001",
    version: "1.0.0",
    generatedAt: now,
    candidate: {
      commitSha: enterpriseCandidateCommit,
      imageDigest: enterpriseCandidateImage,
    },
    artifacts,
    gateEvidence,
    approvals: ENTERPRISE_RELEASE_APPROVAL_ROLES.map((role) => ({
      role,
      status: "approved" as const,
      approver: `${role}-approver@example.test`,
      approvedAt: now,
    })),
  };
  const manifestPath = join(root, "release-materials.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, manifestPath, manifest };
}

export function configureEnterpriseReleaseMaterialsEnv(tempDirs: string[]) {
  const fixture = writeReadyEnterpriseManifest(tempDirs);
  process.env.ENTERPRISE_RELEASE_MATERIALS_FILE = fixture.manifestPath;
  process.env.ENTERPRISE_RELEASE_REPOSITORY_ROOT = fixture.root;
  process.env.ENTERPRISE_RELEASE_CANDIDATE_COMMIT = enterpriseCandidateCommit;
  process.env.ENTERPRISE_RELEASE_IMAGE_DIGEST = enterpriseCandidateImage;
  return fixture;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
