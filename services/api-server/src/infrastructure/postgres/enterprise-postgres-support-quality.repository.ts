import type {
  EnterpriseSupportQualityDashboard,
  EnterpriseSupportQualityFindingCode,
  EnterpriseSupportQualityFindingRecord,
  EnterpriseSupportQualityReviewRecord,
  EnterpriseSupportQualityRuleVersionRecord,
  EnterpriseSupportQualitySessionSummary,
} from "../../modules/enterprise/enterprise-support-quality.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";

export class EnterpriseSupportQualityPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createRuleVersion(input: {
    id: string; engineVersion: string; locale: string;
    identityDisclosurePhrases: string[]; prohibitedPromisePhrases: string[];
    idempotencyKey: string; requestHash: string; publishedBy: string;
    publishedAt: string;
  }) {
    await this.session.queryTenantRecord(`
      SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE
    `);
    const next = await this.session.query<{ revision: string }>(`
      SELECT (COALESCE(max(revision), 0) + 1)::text AS revision
      FROM enterprise.support_quality_rule_versions WHERE tenant_id = $1
    `);
    const revision = positive(Number(next.rows[0]?.revision));
    const result = await this.session.query<RuleRow>(`
      INSERT INTO enterprise.support_quality_rule_versions(
        tenant_id, id, engine_version, revision, locale, identity_disclosure_phrases,
        prohibited_promise_phrases, idempotency_key, request_hash,
        published_by, published_at, created_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [uuid(input.id), code(input.engineVersion, 80), revision,
      locale(input.locale),
      phrases(input.identityDisclosurePhrases, 1, 16),
      phrases(input.prohibitedPromisePhrases, 0, 32), key(input.idempotencyKey),
      hash(input.requestHash), enterprisePostgresAccountSubjectId(input.publishedBy),
      timestamp(input.publishedAt)]);
    return result.rows[0] ? mapRule(result.rows[0]) : null;
  }

  async findRuleByKey(idempotencyKey: string, lock = false) {
    const result = await this.session.query<RuleRow>(`
      SELECT * FROM enterprise.support_quality_rule_versions
      WHERE tenant_id = $1 AND idempotency_key = $2
      ${lock ? "FOR UPDATE" : ""}
    `, [key(idempotencyKey)]);
    return result.rows[0] ? mapRule(result.rows[0]) : null;
  }

  async findRule(id: string) {
    const result = await this.session.query<RuleRow>(`
      SELECT * FROM enterprise.support_quality_rule_versions
      WHERE tenant_id = $1 AND id = $2
    `, [uuid(id)]);
    return result.rows[0] ? mapRule(result.rows[0]) : null;
  }

  async resolveRule(localeValue: string) {
    const value = locale(localeValue);
    const result = await this.session.query<RuleRow>(`
      SELECT * FROM enterprise.support_quality_rule_versions
      WHERE tenant_id = $1 AND locale IN ($2, '*')
      ORDER BY (locale = $2) DESC, published_at DESC, revision DESC LIMIT 1
    `, [value]);
    return result.rows[0] ? mapRule(result.rows[0]) : null;
  }

  async listRuleVersions(limit = 100) {
    const result = await this.session.query<RuleRow>(`
      SELECT * FROM enterprise.support_quality_rule_versions
      WHERE tenant_id = $1 ORDER BY published_at DESC, revision DESC LIMIT $2
    `, [boundedLimit(limit)]);
    return result.rows.map(mapRule);
  }

  async createReview(input: {
    review: EnterpriseSupportQualityReviewRecord;
    findings: EnterpriseSupportQualityFindingRecord[];
  }) {
    const review = input.review;
    const inserted = await this.session.query<ReviewRow>(`
      INSERT INTO enterprise.support_quality_reviews(
        tenant_id, id, support_session_id, run_id, rule_version_id,
        engine_version, source_hash, status, semantic_status,
        semantic_reason_code, evaluated_turn_count, evaluated_rule_count,
        finding_count, critical_count, high_count, medium_count,
        analyzed_by, analyzed_at, created_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $18, 1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [uuid(review.id), uuid(review.supportSessionId), uuid(review.runId),
      uuid(review.ruleVersionId), code(review.engineVersion, 80),
      hash(review.sourceHash), review.status, review.semanticStatus,
      review.semanticReasonCode ?? null, count(review.evaluatedTurnCount),
      positive(review.evaluatedRuleCount), count(review.findingCount),
      count(review.criticalCount), count(review.highCount), count(review.mediumCount),
      enterprisePostgresAccountSubjectId(review.analyzedBy),
      timestamp(review.analyzedAt)]);
    if (!inserted.rows[0]) return null;
    for (const finding of input.findings) await this.insertFinding(finding);
    return mapReview(inserted.rows[0]);
  }

  async findReview(sessionId: string, ruleId: string, sourceHash: string) {
    const result = await this.session.query<ReviewRow>(`
      SELECT * FROM enterprise.support_quality_reviews
      WHERE tenant_id = $1 AND support_session_id = $2 AND
        rule_version_id = $3 AND source_hash = $4
    `, [uuid(sessionId), uuid(ruleId), hash(sourceHash)]);
    return result.rows[0] ? mapReview(result.rows[0]) : null;
  }

  async latestReview(sessionId: string) {
    const result = await this.session.query<ReviewRow>(`
      SELECT * FROM enterprise.support_quality_reviews
      WHERE tenant_id = $1 AND support_session_id = $2
      ORDER BY analyzed_at DESC, id DESC LIMIT 1
    `, [uuid(sessionId)]);
    return result.rows[0] ? mapReview(result.rows[0]) : null;
  }

  async listLatestReviews(limit = 100): Promise<EnterpriseSupportQualitySessionSummary[]> {
    const reviews = await this.session.query<ReviewRow>(`
      SELECT * FROM (
        SELECT DISTINCT ON (support_session_id) *
        FROM enterprise.support_quality_reviews WHERE tenant_id = $1
        ORDER BY support_session_id, analyzed_at DESC, id DESC
      ) latest ORDER BY analyzed_at DESC, id DESC LIMIT $2
    `, [boundedLimit(limit)]);
    if (reviews.rows.length === 0) return [];
    const ids = reviews.rows.map((row) => row.id);
    const findings = await this.session.query<{ review_id: string;
      code: EnterpriseSupportQualityFindingCode }>(`
      SELECT review_id, code FROM enterprise.support_quality_findings
      WHERE tenant_id = $1 AND review_id = ANY($2::uuid[])
      ORDER BY created_at, id
    `, [ids]);
    const byReview = new Map<string, EnterpriseSupportQualityFindingCode[]>();
    for (const item of findings.rows) {
      const values = byReview.get(item.review_id) ?? [];
      if (!values.includes(item.code)) values.push(item.code);
      byReview.set(item.review_id, values);
    }
    return reviews.rows.map((row) => ({ review: mapReview(row),
      findingCodes: byReview.get(row.id) ?? [] }));
  }

  async dashboard(): Promise<EnterpriseSupportQualityDashboard> {
    const result = await this.session.query<DashboardRow>(`
      WITH latest AS (
        SELECT DISTINCT ON (support_session_id) *
        FROM enterprise.support_quality_reviews WHERE tenant_id = $1
        ORDER BY support_session_id, analyzed_at DESC, id DESC
      ), finding_totals AS (
        SELECT count(DISTINCT finding.support_session_id) FILTER (
            WHERE finding.code = 'identity_disclosure_missing'
          )::text AS disclosure_sessions,
          count(*) FILTER (
            WHERE finding.code = 'answer_without_citation'
          )::text AS unsupported_answers
        FROM enterprise.support_quality_findings finding
        JOIN latest review ON review.id = finding.review_id AND
          review.tenant_id = finding.tenant_id
        WHERE finding.tenant_id = $1
      )
      SELECT count(*)::text AS review_count,
        COALESCE(sum(finding_count), 0)::text AS finding_count,
        COALESCE(sum(critical_count), 0)::text AS critical_count,
        COALESCE(sum(high_count), 0)::text AS high_count,
        COALESCE(sum(medium_count), 0)::text AS medium_count,
        max(analyzed_at) AS latest_analyzed_at,
        finding_totals.disclosure_sessions, finding_totals.unsupported_answers
      FROM latest CROSS JOIN finding_totals
      GROUP BY finding_totals.disclosure_sessions, finding_totals.unsupported_answers
    `);
    return mapDashboard(result.rows[0]);
  }

  async listFindings(reviewId: string) {
    const result = await this.session.query<FindingRow>(`
      SELECT * FROM enterprise.support_quality_findings
      WHERE tenant_id = $1 AND review_id = $2
      ORDER BY turn_sequence, severity, code, id
    `, [uuid(reviewId)]);
    return result.rows.map(mapFinding);
  }

  private async insertFinding(finding: EnterpriseSupportQualityFindingRecord) {
    const result = await this.session.query<FindingRow>(`
      INSERT INTO enterprise.support_quality_findings(
        tenant_id, id, review_id, support_session_id, run_id, turn_id,
        turn_sequence, code, severity, evidence_hash, created_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
      RETURNING *
    `, [uuid(finding.id), uuid(finding.reviewId), uuid(finding.supportSessionId),
      uuid(finding.runId), uuid(finding.turnId), positive(finding.turnSequence),
      finding.code, finding.severity, hash(finding.evidenceHash),
      timestamp(finding.createdAt)]);
    if (!result.rows[0]) throw new Error("Support quality finding insert failed");
  }
}

interface RuleRow extends Record<string, unknown> { id: string; tenant_id: string;
  revision: string | number; engine_version: string; locale: string;
  identity_disclosure_phrases: string[]; prohibited_promise_phrases: string[];
  idempotency_key: string; request_hash: string; published_by: string;
  published_at: string | Date; created_at: string | Date; version: string | number }
interface ReviewRow extends Record<string, unknown> { id: string; tenant_id: string;
  support_session_id: string; run_id: string; rule_version_id: string;
  engine_version: string; source_hash: string; status: "complete" | "partial";
  semantic_status: "ready" | "not_configured" | "failed";
  semantic_reason_code: string | null; evaluated_turn_count: string | number;
  evaluated_rule_count: string | number; finding_count: string | number;
  critical_count: string | number; high_count: string | number;
  medium_count: string | number; analyzed_by: string; analyzed_at: string | Date;
  created_at: string | Date; version: string | number }
interface FindingRow extends Record<string, unknown> { id: string; tenant_id: string;
  review_id: string; support_session_id: string; run_id: string; turn_id: string;
  turn_sequence: string | number; code: EnterpriseSupportQualityFindingCode;
  severity: "critical" | "high" | "medium"; evidence_hash: string;
  created_at: string | Date; version: string | number }
interface DashboardRow extends Record<string, unknown> { review_count: string;
  finding_count: string; critical_count: string; high_count: string;
  medium_count: string; disclosure_sessions: string; unsupported_answers: string;
  latest_analyzed_at: string | Date | null }

function mapRule(row: RuleRow): EnterpriseSupportQualityRuleVersionRecord {
  return { id: row.id, tenantId: row.tenant_id, revision: Number(row.revision),
    engineVersion: row.engine_version, locale: row.locale,
    identityDisclosurePhrases: [...row.identity_disclosure_phrases],
    prohibitedPromisePhrases: [...row.prohibited_promise_phrases],
    idempotencyKey: row.idempotency_key, requestHash: row.request_hash,
    publishedBy: row.published_by, publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at), version: Number(row.version) };
}
function mapReview(row: ReviewRow): EnterpriseSupportQualityReviewRecord {
  return { id: row.id, tenantId: row.tenant_id,
    supportSessionId: row.support_session_id, runId: row.run_id,
    ruleVersionId: row.rule_version_id, engineVersion: row.engine_version,
    sourceHash: row.source_hash, status: row.status,
    semanticStatus: row.semantic_status,
    ...(row.semantic_reason_code ? { semanticReasonCode: row.semantic_reason_code } : {}),
    evaluatedTurnCount: Number(row.evaluated_turn_count),
    evaluatedRuleCount: Number(row.evaluated_rule_count),
    findingCount: Number(row.finding_count), criticalCount: Number(row.critical_count),
    highCount: Number(row.high_count), mediumCount: Number(row.medium_count),
    analyzedBy: row.analyzed_by, analyzedAt: iso(row.analyzed_at),
    createdAt: iso(row.created_at), version: Number(row.version) };
}
function mapFinding(row: FindingRow): EnterpriseSupportQualityFindingRecord {
  return { id: row.id, tenantId: row.tenant_id, reviewId: row.review_id,
    supportSessionId: row.support_session_id, runId: row.run_id,
    turnId: row.turn_id, turnSequence: Number(row.turn_sequence), code: row.code,
    severity: row.severity, evidenceHash: row.evidence_hash,
    createdAt: iso(row.created_at), version: Number(row.version) };
}
function mapDashboard(row?: DashboardRow): EnterpriseSupportQualityDashboard {
  return { reviewCount: Number(row?.review_count ?? 0),
    findingCount: Number(row?.finding_count ?? 0),
    criticalCount: Number(row?.critical_count ?? 0), highCount: Number(row?.high_count ?? 0),
    mediumCount: Number(row?.medium_count ?? 0),
    disclosureMissingSessionCount: Number(row?.disclosure_sessions ?? 0),
    unsupportedAnswerCount: Number(row?.unsupported_answers ?? 0),
    semanticIncorrectAnswerRate: null, semanticStatus: "not_configured",
    semanticReasonCode: "support_quality_semantic_model_not_configured",
    ...(row?.latest_analyzed_at ? { latestAnalyzedAt: iso(row.latest_analyzed_at) } : {}) };
}
function text(value: unknown, max: number) { const item = typeof value === "string"
  ? value.trim() : ""; if (!item || Buffer.byteLength(item) > max)
  throw new Error("Invalid support quality value"); return item; }
function uuid(value: unknown) { const item = text(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item))
    throw new Error("Invalid support quality ID"); return item; }
function key(value: unknown) { const item = text(value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(item))
    throw new Error("Invalid support quality key"); return item; }
function hash(value: unknown) { const item = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(item)) throw new Error("Invalid support quality hash");
  return item; }
function code(value: unknown, max: number) { const item = text(value, max);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(item))
    throw new Error("Invalid support quality code"); return item; }
function locale(value: unknown) { const item = text(value, 40);
  if (item !== "*" && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(item))
    throw new Error("Invalid support quality locale");
  if (item === "*") return item;
  try { return Intl.getCanonicalLocales(item)[0]!; }
  catch { throw new Error("Invalid support quality locale"); }
}
function phrases(value: unknown, min: number, max: number) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(
    "Invalid support quality phrases");
  return value.map((item) => { const phrase = text(item, 240);
    if (phrase !== item) throw new Error("Invalid support quality phrase"); return phrase; });
}
function timestamp(value: unknown) { const item = text(value, 64);
  if (!Number.isFinite(Date.parse(item)) || new Date(item).toISOString() !== item)
    throw new Error("Invalid support quality timestamp"); return item; }
function positive(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1)
  throw new Error("Invalid support quality number"); return Number(value); }
function count(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0)
  throw new Error("Invalid support quality count"); return Number(value); }
function boundedLimit(value: number) { if (!Number.isSafeInteger(value) || value < 1 || value > 200)
  throw new Error("Invalid support quality limit"); return value; }
function iso(value: string | Date) { return new Date(value).toISOString(); }
