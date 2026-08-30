export const ENTERPRISE_RELEASE_ARTIFACT_KINDS = [
  "service_description",
  "release_notes",
  "service_level_agreement",
  "privacy_and_data_processing",
  "administrator_guide",
  "operations_and_incident_runbook",
  "release_checklist",
] as const;

export type EnterpriseReleaseArtifactKind =
  typeof ENTERPRISE_RELEASE_ARTIFACT_KINDS[number];

export const ENTERPRISE_RELEASE_GATES = [
  "A0",
  "A1",
  "A2",
  "A3",
  "H1",
  "H2",
  "H3",
] as const;

export type EnterpriseReleaseGate = typeof ENTERPRISE_RELEASE_GATES[number];

export const ENTERPRISE_RELEASE_APPROVAL_ROLES = [
  "product",
  "engineering",
  "security",
  "privacy",
  "operations",
  "legal",
] as const;

export type EnterpriseReleaseApprovalRole =
  typeof ENTERPRISE_RELEASE_APPROVAL_ROLES[number];

export interface EnterpriseReleaseFileArtifact {
  kind: EnterpriseReleaseArtifactKind;
  path: string;
  sha256: string;
  status: "draft" | "approved";
  approvedBy?: string;
  approvedAt?: string;
}

export interface EnterpriseReleaseGateEvidence {
  gate: EnterpriseReleaseGate;
  status: "pending" | "passed";
  acceptanceIds: string[];
  evidencePath?: string;
  evidenceSha256?: string;
  commitSha?: string;
  imageDigest?: string;
  reviewer?: string;
  verifiedAt?: string;
}

export interface EnterpriseReleaseApproval {
  role: EnterpriseReleaseApprovalRole;
  status: "pending" | "approved";
  approver?: string;
  approvedAt?: string;
}

export interface EnterpriseReleaseMaterialsManifest {
  schemaVersion: 1;
  product: "ai-phone-enterprise";
  releaseId: string;
  version: string;
  generatedAt: string;
  candidate: {
    commitSha: string;
    imageDigest: string;
  };
  artifacts: EnterpriseReleaseFileArtifact[];
  gateEvidence: EnterpriseReleaseGateEvidence[];
  approvals: EnterpriseReleaseApproval[];
}

export const ENTERPRISE_RELEASE_CHECKED_ITEMS = [
  "candidate_identity",
  "service_description",
  "release_notes",
  "service_level_agreement",
  "privacy_and_data_processing",
  "administrator_guide",
  "operations_and_incident_runbook",
  "release_checklist",
  "acceptance_gates_a0_a3",
  "hardening_gates_h1_h3",
  "product_engineering_approval",
  "security_privacy_legal_approval",
  "operations_approval",
  "artifact_hashes",
  "evidence_candidate_binding",
] as const;
