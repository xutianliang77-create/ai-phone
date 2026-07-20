import { createHash } from "node:crypto";

const sourcePath = /^(apps|packages|services)\/[^/]+\/src\//;
const sourceExtension = /\.(?:cjs|js|mjs|ts|tsx|py)$/;

const rules = [
  sourceRule("ENT-SAST-001", "P0", "Dynamic eval is forbidden", /\beval\s*\(/),
  sourceRule("ENT-SAST-002", "P1", "Dynamic Function construction is forbidden", /\bnew\s+Function\s*\(/),
  sourceRule("ENT-SAST-003", "P0", "Global TLS verification cannot be disabled", /NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["']?0/),
  sourceRule("ENT-SAST-004", "P1", "Raw HTML injection requires a reviewed renderer", /dangerouslySetInnerHTML\s*=/),
  sourceRule("ENT-SAST-005", "P1", "CORS cannot reflect every browser origin", /\borigin\s*:\s*true\b/, (content) => content.includes("@fastify/cors")),
  sourceRule("ENT-SAST-006", "P1", "Child processes cannot use a command shell", /\bshell\s*:\s*true\b/, (content) => content.includes("node:child_process")),
  sourceRule("ENT-SAST-007", "P1", "Python subprocess cannot use shell=True", /\bshell\s*=\s*True\b/),
  sourceRule("ENT-SAST-008", "P1", "Python HTTP clients cannot disable TLS verification", /\bverify\s*=\s*False\b/),
  sourceRule("ENT-SAST-009", "P1", "Unsafe pickle deserialization is forbidden", /\bpickle\.loads?\s*\(/),
  mobileRule("ENT-SAST-010", "P0", "Dart cannot accept arbitrary TLS certificates", /\bbadCertificateCallback\b/),
  mobileRule("ENT-SAST-011", "P1", "Dart processes cannot run through a command shell", /\brunInShell\s*:\s*true\b/),
  mobileRule("ENT-SAST-012", "P1", "Android release cannot allow cleartext traffic", /usesCleartextTraffic\s*=\s*["']true/),
  mobileRule("ENT-SAST-013", "P1", "Android WebView cannot always allow mixed content", /MIXED_CONTENT_ALWAYS_ALLOW/),
  mobileRule("ENT-SAST-014", "P1", "iOS release cannot allow arbitrary network loads", /NSAllowsArbitraryLoads/),
  mobileRule("ENT-SAST-015", "P0", "iOS cannot accept arbitrary TLS certificates", /allowsAnyHTTPSCertificateForHost/),
  secretRule("ENT-SECRET-001", "P0", "Private key material is tracked", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/),
  secretRule("ENT-SECRET-002", "P0", "GitHub credential is tracked", /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/),
  secretRule("ENT-SECRET-003", "P0", "Slack credential is tracked", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/),
  secretRule("ENT-SECRET-004", "P0", "OpenAI credential is tracked", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/),
  secretRule("ENT-SECRET-005", "P0", "AWS access key is tracked", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/),
  secretRule("ENT-SECRET-006", "P0", "Google API credential is tracked", /\bAIza[0-9A-Za-z_-]{35}\b/),
];

export function scanEnterpriseStaticSecurity({ files, policy, inputIssues = [] }) {
  const issues = [...inputIssues, ...policyIssues(policy)];
  const findings = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const rule of rules) {
      if (!rule.applies(file.path, file.content)) continue;
      lines.forEach((line, index) => {
        if (!rule.pattern.test(line)) return;
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          path: file.path,
          line: index + 1,
          lineHash: sha256(line.trim()),
          description: rule.description,
        });
      });
    }
  }
  const blocked = findings.filter((finding) =>
    policy.blockedSeverities?.includes(finding.severity));
  return {
    schemaVersion: 1,
    gate: "enterprise_static_security",
    status: issues.length === 0 && blocked.length === 0 ? "pass" : "not_ready",
    scannedFiles: files.length,
    ruleCount: rules.length,
    findingCounts: countBySeverity(findings),
    findings,
    issues,
  };
}

export const enterpriseStaticRuleIds = Object.freeze(rules.map((rule) => rule.id));

function sourceRule(id, severity, description, pattern, contentGuard = () => true) {
  return {
    id, severity, description, pattern,
    applies: (path, content) => sourcePath.test(path) && sourceExtension.test(path) &&
      !/\.(?:spec|test)\.[^.]+$/.test(path) && contentGuard(content),
  };
}

function secretRule(id, severity, description, pattern) {
  return { id, severity, description, pattern, applies: () => true };
}

function mobileRule(id, severity, description, pattern) {
  return {
    id, severity, description, pattern,
    applies: (path) => path.startsWith("apps/mobile/") &&
      !/(?:^|\/)(?:debug|profile|test|build)(?:\/|$)/.test(path),
  };
}

function policyIssues(policy) {
  const issues = [];
  if (policy?.schemaVersion !== 1) issues.push("Security policy schemaVersion must be 1");
  const blocked = [...(policy?.blockedSeverities ?? [])].sort();
  if (JSON.stringify(blocked) !== JSON.stringify(["P0", "P1"])) {
    issues.push("Security policy must block exactly P0 and P1");
  }
  const required = [...(policy?.requiredStaticRuleIds ?? [])].sort();
  const actual = [...enterpriseStaticRuleIds].sort();
  if (JSON.stringify(required) !== JSON.stringify(actual)) {
    issues.push("Security policy static rule manifest differs from implementation");
  }
  return issues;
}

function countBySeverity(findings) {
  return Object.fromEntries(["P0", "P1", "P2", "P3"].map((severity) => [
    severity,
    findings.filter((finding) => finding.severity === severity).length,
  ]));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
