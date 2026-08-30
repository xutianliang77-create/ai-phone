import { rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getEnterpriseReleaseMaterialsReadinessForFile } from
  "./enterprise-release-materials-readiness.js";
import {
  enterpriseCandidateCommit,
  enterpriseCandidateImage,
  writeReadyEnterpriseManifest,
} from "./enterprise-release-materials-readiness-test-helpers.js";

describe("enterprise release materials readiness", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("accepts one candidate-bound approved release package", () => {
    const fixture = writeReadyEnterpriseManifest(tempDirs);
    const result = getEnterpriseReleaseMaterialsReadinessForFile(
      fixture.manifestPath,
      {
        repositoryRoot: fixture.root,
        expectedCommitSha: enterpriseCandidateCommit,
        expectedImageDigest: enterpriseCandidateImage,
      },
    );
    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
  });

  it("rejects evidence from another candidate", () => {
    const fixture = writeReadyEnterpriseManifest(tempDirs);
    fixture.manifest.gateEvidence[0]!.commitSha = "c".repeat(40);
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
    const result = getEnterpriseReleaseMaterialsReadinessForFile(
      fixture.manifestPath,
      { repositoryRoot: fixture.root },
    );
    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("enterprise release A0 gate commitSha mismatch");
  });

  it("rejects draft material and pending approval", () => {
    const fixture = writeReadyEnterpriseManifest(tempDirs);
    fixture.manifest.artifacts[0]!.status = "draft";
    fixture.manifest.approvals[0]!.status = "pending";
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
    const result = getEnterpriseReleaseMaterialsReadinessForFile(
      fixture.manifestPath,
      { repositoryRoot: fixture.root },
    );
    expect(result.issues).toContain(
      "enterprise release service_description is not approved",
    );
    expect(result.issues).toContain(
      "enterprise release product approval is not approved",
    );
  });

  it("rejects changed evidence content", () => {
    const fixture = writeReadyEnterpriseManifest(tempDirs);
    writeFileSync(`${fixture.root}/gate-H3.json`, "changed");
    const result = getEnterpriseReleaseMaterialsReadinessForFile(
      fixture.manifestPath,
      { repositoryRoot: fixture.root },
    );
    expect(result.issues).toContain("enterprise release H3 gate sha256 mismatch");
  });
});
