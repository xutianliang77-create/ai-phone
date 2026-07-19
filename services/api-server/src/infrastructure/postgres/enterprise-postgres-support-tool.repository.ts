import type {
  EnterpriseScope,
  EnterpriseSupportToolConfirmationMode,
  EnterpriseSupportToolInputSchema,
  EnterpriseSupportToolRiskLevel,
} from "@translation/contracts";
import type {
  EnterpriseSupportToolDefinitionRecord,
  PreparedEnterpriseSupportToolDefinition,
} from "../../modules/enterprise/enterprise-support-tool-registry.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseSupportToolPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createDefinition(input: {
    id: string;
    definition: PreparedEnterpriseSupportToolDefinition;
    createdBy: string;
    createdAt: string;
  }) {
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const revision = await this.session.query<{ revision: string }>(`
      SELECT COALESCE(max(revision), 0)::text AS revision
      FROM enterprise.support_tool_definitions
      WHERE tenant_id = $1 AND tool_name = $2
    `, [input.definition.toolName]);
    const next = Number(revision.rows[0]?.revision ?? 0) + 1;
    const createdAt = timestamp(input.createdAt);
    const definition = input.definition;
    const inserted = await this.session.query<DefinitionRow>(`
      INSERT INTO enterprise.support_tool_definitions(
        tenant_id, id, tool_name, revision, status, description, risk_level,
        required_scope, confirmation_mode, input_schema, schema_hash,
        created_by, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9::jsonb,
        $10, $11, $12, $12, 1) RETURNING *
    `, [uuid(input.id), definition.toolName, next, definition.description,
      definition.riskLevel, definition.requiredScope, definition.confirmationMode,
      JSON.stringify(definition.inputSchema), definition.schemaHash,
      enterprisePostgresAccountSubjectId(input.createdBy), createdAt]);
    return { status: "created" as const, definition: mapDefinition(inserted.rows[0]!) };
  }

  async listDefinitions() {
    const result = await this.session.query<DefinitionRow>(`
      SELECT * FROM enterprise.support_tool_definitions
      WHERE tenant_id = $1 ORDER BY tool_name, revision DESC, id
    `);
    return result.rows.map(mapDefinition);
  }

  async findDefinition(id: string, lock = false) {
    const result = await this.session.query<DefinitionRow>(`
      SELECT * FROM enterprise.support_tool_definitions
      WHERE tenant_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}
    `, [uuid(id)]);
    return result.rows[0] ? mapDefinition(result.rows[0]) : null;
  }

  async findActive(toolName: string, lock = false) {
    const result = await this.session.query<DefinitionRow>(`
      SELECT * FROM enterprise.support_tool_definitions
      WHERE tenant_id = $1 AND tool_name = $2 AND status = 'active'
      ${lock ? "FOR UPDATE" : ""}
    `, [toolCode(toolName)]);
    return result.rows[0] ? mapDefinition(result.rows[0]) : null;
  }

  async publishDefinition(input: {
    id: string;
    expectedVersion: number;
    publishedBy: string;
    publishedAt: string;
  }) {
    await this.session.queryTenantRecord(
      "SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE",
    );
    const definition = await this.findDefinition(input.id, true);
    if (!definition) return { status: "not_found" as const };
    if (definition.status !== "draft" || definition.version !== input.expectedVersion) {
      return { status: "conflict" as const };
    }
    const publishedAt = timestamp(input.publishedAt);
    const actor = enterprisePostgresAccountSubjectId(input.publishedBy);
    const active = await this.findActive(definition.toolName, true);
    if (active) {
      const retired = await this.session.query<DefinitionRow>(`
        UPDATE enterprise.support_tool_definitions SET status = 'retired',
          retired_by = $3, retired_at = $4, updated_at = $4,
          version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $5 AND status = 'active'
        RETURNING *
      `, [active.id, actor, publishedAt, active.version]);
      if (!retired.rows[0]) return { status: "conflict" as const };
    }
    const published = await this.session.query<DefinitionRow>(`
      UPDATE enterprise.support_tool_definitions SET status = 'active',
        published_by = $3, published_at = $4, updated_at = $4,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $5 AND status = 'draft'
      RETURNING *
    `, [definition.id, actor, publishedAt, definition.version]);
    return published.rows[0]
      ? { status: "published" as const,
          definition: mapDefinition(published.rows[0]) }
      : { status: "conflict" as const };
  }

  async retireDefinition(input: {
    id: string;
    expectedVersion: number;
    retiredBy: string;
    retiredAt: string;
  }) {
    const retired = await this.session.query<DefinitionRow>(`
      UPDATE enterprise.support_tool_definitions SET status = 'retired',
        retired_by = $3, retired_at = $4, updated_at = $4,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $5 AND status = 'active'
      RETURNING *
    `, [uuid(input.id), enterprisePostgresAccountSubjectId(input.retiredBy),
      timestamp(input.retiredAt), positive(input.expectedVersion)]);
    if (retired.rows[0]) return { status: "retired" as const,
      definition: mapDefinition(retired.rows[0]) };
    const current = await this.findDefinition(input.id);
    return { status: current ? "conflict" as const : "not_found" as const };
  }
}

function mapDefinition(row: DefinitionRow): EnterpriseSupportToolDefinitionRecord {
  return { id: row.id, tenantId: row.tenant_id, toolName: row.tool_name,
    revision: Number(row.revision), status: row.status,
    description: row.description, riskLevel: row.risk_level,
    requiredScope: row.required_scope, confirmationMode: row.confirmation_mode,
    inputSchema: row.input_schema, schemaHash: row.schema_hash,
    createdBy: row.created_by,
    ...(row.published_by ? { publishedBy: row.published_by } : {}),
    ...(row.retired_by ? { retiredBy: row.retired_by } : {}),
    createdAt: iso(row.created_at),
    ...(row.published_at ? { publishedAt: iso(row.published_at) } : {}),
    ...(row.retired_at ? { retiredAt: iso(row.retired_at) } : {}),
    version: Number(row.version) };
}

interface DefinitionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  tool_name: string;
  revision: string | number;
  status: EnterpriseSupportToolDefinitionRecord["status"];
  description: string;
  risk_level: EnterpriseSupportToolRiskLevel;
  required_scope: EnterpriseScope;
  confirmation_mode: EnterpriseSupportToolConfirmationMode;
  input_schema: EnterpriseSupportToolInputSchema;
  schema_hash: string;
  created_by: string;
  published_by: string | null;
  retired_by: string | null;
  created_at: string | Date;
  published_at: string | Date | null;
  retired_at: string | Date | null;
  version: string | number;
}

function uuid(value: unknown) {
  if (typeof value !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Invalid support tool id");
  }
  return value;
}
function toolCode(value: unknown) {
  if (typeof value !== "string" ||
    !/^[a-z][a-z0-9_.-]{1,127}$/.test(value)) {
    throw new Error("Invalid support tool name");
  }
  return value;
}
function positive(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("Invalid support tool version");
  }
  return Number(value);
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error("Invalid support tool timestamp");
  }
  return value;
}
function iso(value: string | Date) { return new Date(value).toISOString(); }
