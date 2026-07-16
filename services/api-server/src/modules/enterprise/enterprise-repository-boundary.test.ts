import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const policies = {
  "enterprise-audit.repository.ts": {
    scoped: [
      "appendEnterpriseAuditEvent",
      "listEnterpriseAuditEvents",
    ],
    platform: [],
  },
  "enterprise-tenant-job.repository.ts": {
    scoped: [
      "claimEnterpriseTenantLifecycleJob",
      "finalizeEnterpriseTenantLifecycleJob",
    ],
    platform: ["pendingEnterpriseTenantLifecycleJobRefs"],
  },
  "enterprise-outbox.repository.ts": {
    scoped: [
      "claimEnterpriseOutboxEvent",
      "finalizeEnterpriseOutboxEvent",
    ],
    platform: ["pendingEnterpriseOutboxEventRefs"],
  },
  "enterprise-reliable-events.repository.ts": {
    scoped: [
      "processEnterpriseInboxEvent",
      "enqueueEnterpriseOutboxEvent",
    ],
    platform: [],
  },
  "enterprise-tenant-lifecycle.repository.ts": {
    scoped: [],
    platform: [
      "beginEnterpriseTenantCreation",
      "beginEnterpriseTenantRetry",
      "finalizeEnterpriseTenantProvision",
      "startEnterpriseTenantLifecycleJob",
      "findEnterpriseTenantJob",
    ],
  },
  "enterprise-tenants.repository.ts": {
    scoped: [
      "listEnterpriseMembers",
      "addEnterpriseMember",
      "updateEnterpriseMember",
    ],
    platform: [
      "resolveEnterpriseContext",
      "listEnterpriseMemberships",
    ],
  },
} as const;

describe("enterprise repository boundary", () => {
  for (const [file, policy] of Object.entries(policies)) {
    it(`classifies every exported function in ${file}`, () => {
      const source = repositorySource(file);
      const exported = [...source.matchAll(/^export (?:async )?function (\w+)/gm)]
        .map((match) => match[1])
        .sort();
      const classified = [...policy.scoped, ...policy.platform].sort();

      expect(exported).toEqual(classified);
      for (const name of policy.scoped) {
        const signature = functionSignature(source, name);
        expect(signature).toContain("EnterpriseTenantContext");
        expect(signature).not.toMatch(/\btenantId\s*:\s*string\b/);
      }
    });
  }
});

function repositorySource(file: string) {
  return readFileSync(
    fileURLToPath(new URL(`./${file}`, import.meta.url)),
    "utf8",
  );
}

function functionSignature(source: string, name: string) {
  const direct = source.indexOf(`export function ${name}`);
  const asynchronous = source.indexOf(`export async function ${name}`);
  const start = Math.max(direct, asynchronous);
  const end = source.indexOf(") {", start);
  if (start < 0 || end < 0) throw new Error(`Missing function ${name}`);
  return source.slice(start, end + 1);
}
