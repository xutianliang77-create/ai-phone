import type {
  EnterpriseCustomerDirectoryCaseDto,
  EnterpriseCustomerDirectoryItemDto,
  EnterpriseCustomerDirectorySessionDto,
} from "@translation/contracts";
import type { EnterpriseContactDirectoryPosition } from
  "../../modules/enterprise/enterprise-contact-directory.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

interface CustomerRow extends Record<string, unknown> {
  tenant_id: unknown; id: unknown; external_id: unknown; display_name: unknown;
  locale: unknown; consent_scope: unknown; directory_updated_at: unknown;
  session_count: unknown; open_case_count: unknown; last_session_id: unknown;
  last_session_status: unknown; last_channel_type: unknown;
  last_session_created_at: unknown; last_session_started_at: unknown;
  last_session_ended_at: unknown; last_session_updated_at: unknown;
}
interface SessionRow extends Record<string, unknown> {
  tenant_id: unknown; customer_id: unknown; id: unknown; status: unknown;
  channel_type: unknown; created_at: unknown; started_at: unknown;
  ended_at: unknown; updated_at: unknown;
}
interface CaseRow extends Record<string, unknown> {
  tenant_id: unknown; customer_id: unknown; id: unknown; status: unknown;
  created_at: unknown; resolved_at: unknown; closed_at: unknown;
  updated_at: unknown;
}

export class EnterpriseCustomerDirectoryPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async list(input: { limit: number; before?: EnterpriseContactDirectoryPosition }) {
    const result = await this.session.query<CustomerRow>(`
      WITH directory AS (
        ${customerProjection()}
        WHERE customer.tenant_id = $1
      )
      SELECT * FROM directory
      WHERE ($2::timestamptz IS NULL OR
        (directory_updated_at, id) < ($2::timestamptz, $3::uuid))
      ORDER BY directory_updated_at DESC, id DESC LIMIT $4
    `, [input.before?.updatedAt ?? null, input.before?.id ?? null,
      input.limit + 1]);
    const page = result.rows.slice(0, input.limit).map((row) =>
      mapCustomer(row, this.session.context.tenantId));
    const last = page.at(-1);
    return {
      customers: page,
      ...(result.rows.length > input.limit && last
        ? { nextPosition: { updatedAt: last.updatedAt, id: last.id } }
        : {}),
    };
  }

  async find(customerId: string) {
    const result = await this.session.query<CustomerRow>(`
      ${customerProjection()}
      WHERE customer.tenant_id = $1 AND customer.id = $2 LIMIT 1
    `, [uuid(customerId)]);
    return result.rows[0]
      ? mapCustomer(result.rows[0], this.session.context.tenantId) : null;
  }

  async recentSessions(customerId: string, limit = 20) {
    const result = await this.session.query<SessionRow>(`
      SELECT session.tenant_id, session.customer_id, session.id, session.status,
        channel.channel_type, session.created_at, session.started_at,
        session.ended_at, session.updated_at
      FROM enterprise.support_sessions session
      JOIN enterprise.support_channels channel
        ON channel.tenant_id = session.tenant_id AND channel.id = session.channel_id
      WHERE session.tenant_id = $1 AND session.customer_id = $2
      ORDER BY session.updated_at DESC, session.id DESC LIMIT $3
    `, [uuid(customerId), boundedInteger(limit, 1, 20)]);
    return result.rows.map((row) => mapSession(row,
      this.session.context.tenantId, customerId));
  }

  async recentCases(customerId: string, limit = 20) {
    const result = await this.session.query<CaseRow>(`
      SELECT item.tenant_id, item.customer_id, item.id, item.status,
        item.created_at, item.resolved_at, item.closed_at, item.updated_at
      FROM enterprise.support_cases item
      WHERE item.tenant_id = $1 AND item.customer_id = $2
      ORDER BY item.updated_at DESC, item.id DESC LIMIT $3
    `, [uuid(customerId), boundedInteger(limit, 1, 20)]);
    return result.rows.map((row) => mapCase(row,
      this.session.context.tenantId, customerId));
  }
}

function customerProjection() {
  return `SELECT customer.tenant_id, customer.id, customer.external_id,
      customer.display_name, customer.locale, customer.consent_scope,
      GREATEST(customer.updated_at,
        COALESCE(last_session.updated_at, customer.updated_at),
        COALESCE(case_stats.latest_updated_at, customer.updated_at))
        AS directory_updated_at,
      COALESCE(session_stats.session_count, 0) AS session_count,
      COALESCE(case_stats.open_case_count, 0) AS open_case_count,
      last_session.id AS last_session_id,
      last_session.status AS last_session_status,
      last_session.channel_type AS last_channel_type,
      last_session.created_at AS last_session_created_at,
      last_session.started_at AS last_session_started_at,
      last_session.ended_at AS last_session_ended_at,
      last_session.updated_at AS last_session_updated_at
    FROM enterprise.customer_profiles customer
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint AS session_count
      FROM enterprise.support_sessions item
      WHERE item.tenant_id = customer.tenant_id
        AND item.customer_id = customer.id
    ) session_stats ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE item.status IN ('open', 'pending'))::bigint
          AS open_case_count,
        max(item.updated_at) AS latest_updated_at
      FROM enterprise.support_cases item
      WHERE item.tenant_id = customer.tenant_id
        AND item.customer_id = customer.id
    ) case_stats ON true
    LEFT JOIN LATERAL (
      SELECT item.id, item.status, channel.channel_type, item.created_at,
        item.started_at, item.ended_at, item.updated_at
      FROM enterprise.support_sessions item
      JOIN enterprise.support_channels channel
        ON channel.tenant_id = item.tenant_id AND channel.id = item.channel_id
      WHERE item.tenant_id = customer.tenant_id
        AND item.customer_id = customer.id
      ORDER BY item.updated_at DESC, item.id DESC LIMIT 1
    ) last_session ON true`;
}

function mapCustomer(row: CustomerRow,
  tenantId: string): EnterpriseCustomerDirectoryItemDto {
  if (uuid(row.tenant_id) !== tenantId) throw invalid();
  const lastSessionId = nullableText(row.last_session_id);
  return {
    id: uuid(row.id),
    ...(nullableText(row.external_id)
      ? { externalIdHint: maskExternalId(row.external_id) } : {}),
    ...(nullableText(row.display_name)
      ? { displayName: bounded(row.display_name, 120) } : {}),
    ...(nullableText(row.locale)
      ? { locale: pattern(row.locale,
          /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/) } : {}),
    consentScopes: stringArray(row.consent_scope),
    sessionCount: nonnegative(row.session_count),
    openCaseCount: nonnegative(row.open_case_count),
    ...(lastSessionId ? { lastSession: mapLastSession(row, lastSessionId) }
      : assertAbsentLastSession(row)),
    updatedAt: iso(row.directory_updated_at),
  };
}

function mapLastSession(row: CustomerRow,
  id: string): EnterpriseCustomerDirectorySessionDto {
  return {
    id: uuid(id), status: sessionStatus(row.last_session_status),
    channelType: channelType(row.last_channel_type),
    createdAt: iso(row.last_session_created_at),
    ...(present(row.last_session_started_at)
      ? { startedAt: iso(row.last_session_started_at) } : {}),
    ...(present(row.last_session_ended_at)
      ? { endedAt: iso(row.last_session_ended_at) } : {}),
    updatedAt: iso(row.last_session_updated_at),
  };
}
function mapSession(row: SessionRow, tenantId: string,
  customerId: string): EnterpriseCustomerDirectorySessionDto {
  if (uuid(row.tenant_id) !== tenantId || uuid(row.customer_id) !== customerId)
    throw invalid();
  return { id: uuid(row.id), status: sessionStatus(row.status),
    channelType: channelType(row.channel_type), createdAt: iso(row.created_at),
    ...(present(row.started_at) ? { startedAt: iso(row.started_at) } : {}),
    ...(present(row.ended_at) ? { endedAt: iso(row.ended_at) } : {}),
    updatedAt: iso(row.updated_at) };
}
function mapCase(row: CaseRow, tenantId: string,
  customerId: string): EnterpriseCustomerDirectoryCaseDto {
  if (uuid(row.tenant_id) !== tenantId || uuid(row.customer_id) !== customerId)
    throw invalid();
  return { id: uuid(row.id), status: oneOf(row.status,
      ["open", "pending", "resolved", "closed"] as const),
    createdAt: iso(row.created_at),
    ...(present(row.resolved_at) ? { resolvedAt: iso(row.resolved_at) } : {}),
    ...(present(row.closed_at) ? { closedAt: iso(row.closed_at) } : {}),
    updatedAt: iso(row.updated_at) };
}

function assertAbsentLastSession(row: CustomerRow) { if ([row.last_session_status,
  row.last_channel_type, row.last_session_created_at, row.last_session_started_at,
  row.last_session_ended_at, row.last_session_updated_at].some(present)) throw invalid();
  return {}; }
function sessionStatus(value: unknown) { return oneOf(value, ["created", "waiting",
  "ai_active", "handoff_requested", "human_active", "ended", "failed"] as const); }
function channelType(value: unknown) { return oneOf(value,
  ["pstn", "web", "app"] as const); }
function stringArray(value: unknown) { if (!Array.isArray(value) || value.length > 32)
  throw invalid(); return value.map((item) => pattern(item,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)); }
function maskExternalId(value: unknown) { const text = bounded(value, 200);
  return text.length <= 4 ? `${text[0]}***` :
    `${text.slice(0, 2)}***${text.slice(-2)}`; }
function nullableText(value: unknown) { return value === null || value === undefined
  ? null : bounded(value, 4_000); }
function bounded(value: unknown, max: number) { if (typeof value !== "string" ||
  value !== value.trim() || value.length < 1 || value.length > max) throw invalid();
  return value; }
function pattern(value: unknown, regex: RegExp) { const text = bounded(value, 200);
  if (!regex.test(text)) throw invalid(); return text; }
function uuid(value: unknown) { return pattern(value,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); }
function iso(value: unknown) { const text = value instanceof Date ? value.toISOString()
  : bounded(value, 64); if (!Number.isFinite(Date.parse(text))) throw invalid();
  return new Date(text).toISOString(); }
function nonnegative(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid(); return number; }
function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum ||
    number > maximum) throw invalid(); return number; }
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  const text = bounded(value, 100); if (!values.includes(text as T[number])) throw invalid();
  return text as T[number]; }
function present(value: unknown) { return value !== null && value !== undefined; }
function invalid() { return new Error("Invalid enterprise customer directory row"); }
