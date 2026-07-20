import { describe, expect, test } from "vitest";
import {
  createSignedPenetrationEvidence,
  sha256,
  validatePenetrationPlan,
  verifyPenetrationEvidence,
} from "./enterprise_security_penetration.mjs";

const commitSha = "a".repeat(40);
const signingKey = "security-evidence-key-that-is-at-least-32-characters";

describe("enterprise penetration evidence", () => {
  test("accepts a complete signed result for the locked commit", () => {
    const evidence = signedEvidence();
    expect(verifyPenetrationEvidence({
      evidence, policy: policy(), expectedCommitSha: commitSha, signingKey,
      now: new Date("2026-07-20T01:00:00Z"),
    })).toEqual({ status: "pass", issues: [] });
  });

  test("rejects tampering, stale evidence and a failed attack case", () => {
    const evidence = signedEvidence();
    evidence.cases[0].status = "fail";
    const result = verifyPenetrationEvidence({
      evidence, policy: policy(), expectedCommitSha: commitSha, signingKey,
      now: new Date("2026-08-20T00:00:00Z"),
    });
    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "Penetration evidence contains a failed case",
      "Penetration evidence time window is invalid or expired",
      "Penetration evidence signature is invalid",
    ]));
  });

  test("refuses production, remote HTTP and literal authorization headers", () => {
    const plan = {
      schemaVersion: 1,
      commitSha,
      target: { environment: "production", baseUrl: "http://prod.example.com" },
      cases: cases().map((item, index) => index === 0 ? {
        ...item, headers: { authorization: "literal-token" },
      } : item),
    };
    const result = validatePenetrationPlan(plan, policy(), []);
    expect(result.issues.join(" ")).toContain("test or staging");
    expect(result.issues.join(" ")).toContain("require HTTPS");
    expect(result.issues.join(" ")).toContain("literal sensitive");
  });
});

function signedEvidence() {
  return createSignedPenetrationEvidence({
    schemaVersion: 1,
    gate: "enterprise_penetration",
    status: "pass",
    commitSha,
    target: { environment: "staging", origin: "https://staging.example.com" },
    runner: { name: "wujie-enterprise-negative-http", version: 1 },
    planHash: sha256("plan"),
    startedAt: "2026-07-20T00:00:00Z",
    completedAt: "2026-07-20T00:30:00Z",
    cases: cases().map(({ id, category }) => ({
      id,
      category,
      status: "pass",
      attempts: [{ status: "pass", httpStatus: 401, responseSha256: sha256("denied") }],
    })),
    findings: [],
  }, signingKey);
}

function cases() {
  return policy().penetration.requiredCategories.map((category, index) => ({
    id: `case-${index}`,
    category,
    method: "GET",
    path: "/enterprise/v1/me",
    allowedStatuses: [401],
  }));
}

function policy() {
  return {
    blockedSeverities: ["P0", "P1"],
    penetration: {
      allowedEnvironments: ["test", "staging"],
      maxEvidenceAgeHours: 168,
      minimumCases: 6,
      requiredCategories: [
        "unauthenticated_access", "tenant_context_spoofing", "cross_tenant_access",
        "role_escalation", "webhook_signature_replay", "payload_limit",
      ],
    },
  };
}
