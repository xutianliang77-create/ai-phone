import { describe, expect, it } from "vitest";
import {
  prepareEnterpriseScriptContent,
} from "../../modules/enterprise/enterprise-script-template.js";
import {
  prepareEnterpriseTerms,
} from "../../modules/enterprise/enterprise-terminology.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  EnterpriseScriptTemplatePostgresRepository,
} from "./enterprise-postgres-script-template.repository.js";
import {
  EnterpriseTermPackPostgresRepository,
} from "./enterprise-postgres-term-pack.repository.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const packId = "00000000-0000-4000-8000-000000000031";
const packVersionId = "00000000-0000-4000-8000-000000000032";
const templateId = "00000000-0000-4000-8000-000000000033";
const templateVersionId = "00000000-0000-4000-8000-000000000034";
const now = "2026-07-18T10:00:00.000Z";
const terms = [{
  termId: "refund", sourceText: "退款", translatedText: "refund",
  aliases: ["退费"], caseSensitive: false, protected: true,
}];
const script = {
  promptText: "Use approved enterprise terminology.",
  requiredPhrases: ["May I confirm"],
  prohibitedPhrases: ["guaranteed result"],
  variables: ["customer_name"],
};

describe("enterprise PostgreSQL terminology repositories", () => {
  it("allocates term and script revisions under stable aggregate locks", async () => {
    const fixture = fixtureFor("create");
    const termRepository = new EnterpriseTermPackPostgresRepository(fixture.session);
    const scriptRepository = new EnterpriseScriptTemplatePostgresRepository(fixture.session);

    await expect(termRepository.createVersion({
      id: packVersionId, termPackId: packId,
      dimensions: {
        sourceLocale: "zh-CN", targetLocale: "en-US", countryCode: "CN",
        productCode: "phone-pro", usageScope: "support",
      },
      createdAt: now,
    })).resolves.toMatchObject({
      status: "created", termPackVersion: { revision: 2, status: "draft" },
    });
    await expect(scriptRepository.createVersion({
      id: templateVersionId, scriptTemplateId: templateId,
      locale: "en-US", countryCode: "CN", productCode: "phone-pro", createdAt: now,
    })).resolves.toMatchObject({
      status: "created", scriptTemplateVersion: { revision: 3, status: "draft" },
    });
    expect(fixture.calls.filter(({ sql }) => sql.includes("FOR UPDATE"))).toHaveLength(2);
  });

  it("stages reviewed content with deterministic hashes", async () => {
    const fixture = fixtureFor("stage");
    const termRepository = new EnterpriseTermPackPostgresRepository(fixture.session);
    const scriptRepository = new EnterpriseScriptTemplatePostgresRepository(fixture.session);

    await expect(termRepository.stageVersion({
      versionId: packVersionId, expectedVersion: 1, terms, reviewedAt: now,
    })).resolves.toMatchObject({
      status: "staged",
      termPackVersion: { status: "review", contentHash: prepareEnterpriseTerms(terms).contentHash },
    });
    await expect(scriptRepository.stageVersion({
      versionId: templateVersionId, expectedVersion: 1, content: script, reviewedAt: now,
    })).resolves.toMatchObject({
      status: "staged",
      scriptTemplateVersion: {
        status: "review", contentHash: prepareEnterpriseScriptContent(script).contentHash,
      },
    });
  });

  it("publishes only reviewed versions and updates the stable aggregates", async () => {
    const fixture = fixtureFor("publish");
    const publication = {
      expectedVersion: 2, effectiveFrom: now,
      expiresAt: "2026-08-18T10:00:00.000Z", publishedAt: now,
    };
    await expect(new EnterpriseTermPackPostgresRepository(fixture.session).publishVersion({
      ...publication, versionId: packVersionId,
    })).resolves.toMatchObject({
      status: "published", termPackVersion: { status: "published", version: 3 },
    });
    await expect(new EnterpriseScriptTemplatePostgresRepository(fixture.session).publishVersion({
      ...publication, versionId: templateVersionId,
    })).resolves.toMatchObject({
      status: "published", scriptTemplateVersion: { status: "published", version: 3 },
    });
    expect(fixture.calls.some(({ sql }) => sql.includes("UPDATE enterprise.term_packs"))).toBe(true);
    expect(fixture.calls.some(({ sql }) => sql.includes("UPDATE enterprise.script_templates"))).toBe(true);
  });

  it("resolves only effective published versions and verifies both hashes", async () => {
    const fixture = fixtureFor("resolve");
    const termRepository = new EnterpriseTermPackPostgresRepository(fixture.session);
    const scriptRepository = new EnterpriseScriptTemplatePostgresRepository(fixture.session);

    await expect(termRepository.resolve({
      termPackId: packId, sourceLocale: "zh-CN", targetLocale: "en-US",
      countryCode: "CN", productCode: "phone-pro", purpose: "support", now,
    })).resolves.toMatchObject({ version: { id: packVersionId }, terms });
    await expect(scriptRepository.resolve({
      scriptTemplateId: templateId, locale: "en-US", countryCode: "CN",
      productCode: "phone-pro", purpose: "support", now,
    })).resolves.toMatchObject({ version: { id: templateVersionId }, content: script });
    const resolutionSql = fixture.calls.filter(({ sql }) => sql.includes("status = 'published'"));
    expect(resolutionSql).toHaveLength(2);
    expect(resolutionSql.every(({ sql }) =>
      sql.includes("effective_from <=") && sql.includes("expires_at IS NULL")
    )).toBe(true);
  });
});

type Mode = "create" | "stage" | "publish" | "resolve";

function fixtureFor(mode: Mode) {
  const calls: Call[] = [];
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "user_00000000-0000-4000-8000-000000000002",
    traceId: "trace-terminology-1",
  });
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Array<Record<string, unknown>> = [];
    if (mode === "create" && sql.includes("FROM enterprise.term_packs")) {
      rows = [{ id: packId }];
    } else if (mode === "create" && sql.includes("FROM enterprise.script_templates")) {
      rows = [{ id: templateId }];
    } else if (mode === "create" && sql.includes("term_pack_versions") &&
      sql.includes("max(revision)")) {
      rows = [{ next_revision: "2" }];
    } else if (mode === "create" && sql.includes("script_template_versions") &&
      sql.includes("max(revision)")) {
      rows = [{ next_revision: "3" }];
    } else if (mode === "create" && sql.includes("INSERT INTO enterprise.term_pack_versions")) {
      rows = [termVersionRow({ revision: "2" })];
    } else if (mode === "create" && sql.includes("INSERT INTO enterprise.script_template_versions")) {
      rows = [scriptVersionRow({ revision: "3" })];
    } else if ((mode === "stage" || mode === "publish") &&
      sql.includes("FROM enterprise.term_pack_versions") && sql.includes("FOR UPDATE")) {
      rows = [termVersionRow(mode === "publish" ? {
        status: "review", content_hash: prepareEnterpriseTerms(terms).contentHash,
        terms, version: "2",
      } : {})];
    } else if ((mode === "stage" || mode === "publish") &&
      sql.includes("FROM enterprise.script_template_versions") && sql.includes("FOR UPDATE")) {
      rows = [scriptVersionRow(mode === "publish" ? {
        status: "review", content_hash: prepareEnterpriseScriptContent(script).contentHash,
        ...scriptRowContent(), version: "2",
      } : {})];
    } else if (mode === "stage" && sql.includes("UPDATE enterprise.term_pack_versions")) {
      rows = [termVersionRow({
        status: "review", terms: JSON.parse(String(values[1])),
        content_hash: values[2], version: "2",
      })];
    } else if (mode === "stage" && sql.includes("UPDATE enterprise.script_template_versions")) {
      rows = [scriptVersionRow({
        status: "review", prompt_text: values[1],
        required_phrases: JSON.parse(String(values[2])),
        prohibited_phrases: JSON.parse(String(values[3])),
        variables: JSON.parse(String(values[4])), content_hash: values[5], version: "2",
      })];
    } else if (mode === "publish" && sql.includes("UPDATE enterprise.term_pack_versions")) {
      rows = [termVersionRow({
        status: "published", terms, content_hash: prepareEnterpriseTerms(terms).contentHash,
        effective_from: values[1], expires_at: values[2], published_at: values[4], version: "3",
      })];
    } else if (mode === "publish" && sql.includes("UPDATE enterprise.script_template_versions")) {
      rows = [scriptVersionRow({
        status: "published", ...scriptRowContent(),
        content_hash: prepareEnterpriseScriptContent(script).contentHash,
        effective_from: values[1], expires_at: values[2], published_at: values[4], version: "3",
      })];
    } else if (mode === "resolve" && sql.includes("FROM enterprise.term_pack_versions")) {
      rows = [termVersionRow({
        status: "published", terms, content_hash: prepareEnterpriseTerms(terms).contentHash,
        effective_from: now, published_at: now, version: "3",
      })];
    } else if (mode === "resolve" && sql.includes("FROM enterprise.script_template_versions")) {
      rows = [scriptVersionRow({
        status: "published", ...scriptRowContent(),
        content_hash: prepareEnterpriseScriptContent(script).contentHash,
        effective_from: now, published_at: now, version: "3", purpose: "support",
      })];
    }
    return { rows: rows as Row[] };
  };
  const session = {
    context, query, queryTenantRecord: query, queryCommunication: query,
    queryCommunicationMutation: query, queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
  return { calls, session };
}

function termVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: packVersionId, tenant_id: tenantId, term_pack_id: packId, revision: "1",
    status: "draft", source_locale: "zh-CN", target_locale: "en-US",
    country_code: "CN", product_code: "phone-pro", usage_scope: "support",
    terms: [], content_hash: null, effective_from: null, published_at: null,
    expires_at: null, created_at: now, version: "1", ...overrides,
  };
}

function scriptVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: templateVersionId, tenant_id: tenantId, script_template_id: templateId,
    revision: "1", status: "draft", locale: "en-US", country_code: "CN",
    product_code: "phone-pro", prompt_text: "", required_phrases: [],
    prohibited_phrases: [], variables: [], content_hash: null,
    effective_from: null, published_at: null, expires_at: null,
    created_at: now, version: "1", ...overrides,
  };
}

function scriptRowContent() {
  return {
    prompt_text: script.promptText, required_phrases: script.requiredPhrases,
    prohibited_phrases: script.prohibitedPhrases, variables: script.variables,
  };
}

interface Call { sql: string; values: unknown[] }
