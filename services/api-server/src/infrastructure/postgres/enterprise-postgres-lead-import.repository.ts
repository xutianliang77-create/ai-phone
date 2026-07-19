import { randomUUID } from "node:crypto";
import type {
  EnterpriseLeadImportErrorDto,
  EnterpriseLeadImportRowReportDto,
} from "@translation/contracts";
import type { ImportEnterpriseLeadsInput } from
  "../../modules/enterprise/enterprise-lead-import-runtime.js";
import { protectEnterpriseLeadImportRow } from
  "../../modules/enterprise/enterprise-lead-phone.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  bounded,
  eventKey,
  hash,
  iso,
  issue,
  mapBatch,
  mapLead,
  uuid,
  type CampaignLeadListRow,
  type CampaignLeadRow,
  type LeadImportBatchRow,
  type LeadImportReportRow,
  type LeadRow,
  type ProtectedRow,
} from "./enterprise-postgres-lead-import-mappers.js";
import { rollbackEnterpriseLeadImportBatch } from
  "./enterprise-postgres-lead-import-rollback.js";

export class EnterpriseLeadImportPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async importBatch(input: ImportEnterpriseLeadsInput) {
    await this.lockTenant();
    const replay = await this.findBatchByKey(input.campaignId, input.idempotencyKey, true);
    if (replay) {
      if (replay.request_hash !== hash(input.requestHash) || replay.status !== "committed") {
        return { status: "idempotency_conflict" as const };
      }
      return { status: "replayed" as const, batch: mapBatch(replay),
        rows: await this.listRows(replay.id) };
    }
    const campaign = await this.session.query<{ status: string; approval_status: string }>(`
      SELECT status, approval_status FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `, [uuid(input.campaignId)]);
    if (!campaign.rows[0]) return { status: "not_found" as const };
    if (campaign.rows[0].status !== "draft" ||
      campaign.rows[0].approval_status !== "not_submitted") {
      return { status: "campaign_not_editable" as const };
    }
    const protectedRows = input.rows.map((row) => protectEnterpriseLeadImportRow({
      tenantId: this.session.context.tenantId, id: randomUUID(), row,
      keyring: input.keyring,
    }));
    const identity = await this.resolveIdentities(protectedRows);
    if (identity.errors.length > 0) return { status: "rejected" as const,
      totalRows: protectedRows.length, errors: identity.errors };

    const batchId = randomUUID();
    await this.session.query(`
      INSERT INTO enterprise.marketing_lead_import_batches(
        tenant_id, id, campaign_id, source_kind, source_reference, status,
        total_rows, created_count, linked_count, duplicate_count, created_by,
        idempotency_key, request_hash, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, 'processing', $6, 0, 0, 0, $7, $8, $9,
        $10, $10, 1)
    `, [uuid(batchId), uuid(input.campaignId), input.sourceKind,
      bounded(input.sourceReference, 200), protectedRows.length,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      eventKey(input.idempotencyKey), hash(input.requestHash), iso(input.occurredAt)]);

    const reports: EnterpriseLeadImportRowReportDto[] = [];
    const activeLinks = new Map<string, CampaignLeadRow>();
    const counts = { created: 0, linked: 0, duplicate: 0 };
    for (const row of protectedRows) {
      let lead = identity.byHash.get(row.phoneHash);
      const newLead = !lead;
      if (!lead) {
        const externalId = identity.externalByHash.get(row.phoneHash);
        lead = await this.insertLead(row, batchId, input.occurredAt, externalId);
        identity.byHash.set(row.phoneHash, lead);
      } else if (lead.status === "inactive") {
        lead = await this.reactivateLead(lead, input.occurredAt);
        identity.byHash.set(row.phoneHash, lead);
      }
      let link = activeLinks.get(lead.id);
      if (!link) {
        link = await this.findActiveLink(input.campaignId, lead.id) ?? undefined;
        if (link) activeLinks.set(lead.id, link);
      }
      let result: "created" | "linked" | "duplicate";
      if (link) result = "duplicate";
      else {
        link = await this.insertLink(input.campaignId, lead.id, batchId,
          input.occurredAt);
        activeLinks.set(lead.id, link);
        result = newLead ? "created" : "linked";
      }
      counts[result] += 1;
      const report = { rowNumber: row.rowNumber, result, leadId: lead.id,
        phoneHint: lead.phone_hint };
      reports.push(report);
      await this.insertRow(batchId, link.id, lead.id, row.countryCode, report,
        input.occurredAt);
    }
    const committedAt = new Date(Date.parse(input.occurredAt) + 1).toISOString();
    const committed = await this.session.query<LeadImportBatchRow>(`
      UPDATE enterprise.marketing_lead_import_batches
      SET status = 'committed', created_count = $4, linked_count = $5,
        duplicate_count = $6, committed_at = $7, updated_at = $7,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND campaign_id = $3
        AND status = 'processing' AND version = 1
      RETURNING *
    `, [uuid(batchId), uuid(input.campaignId), counts.created, counts.linked,
      counts.duplicate, committedAt]);
    if (!committed.rows[0]) throw new Error("Lead import commit conflict");
    return { status: "committed" as const, batch: mapBatch(committed.rows[0]),
      rows: reports };
  }

  async listLeads(campaignId: string) {
    const result = await this.session.query<CampaignLeadListRow>(`
      SELECT l.id, cl.id AS link_id, l.external_id, l.phone_hint, l.country_code,
        l.timezone, l.language, l.attributes, l.status, cl.import_batch_id,
        cl.created_at AS linked_at, l.version
      FROM enterprise.marketing_campaign_leads cl
      JOIN enterprise.marketing_leads l
        ON l.tenant_id = cl.tenant_id AND l.id = cl.lead_id
      WHERE cl.tenant_id = $1 AND cl.campaign_id = $2 AND cl.status = 'active'
      ORDER BY cl.created_at DESC, cl.id
      LIMIT 1000
    `, [uuid(campaignId)]);
    return result.rows.map(mapLead);
  }

  async listBatches(campaignId: string) {
    const result = await this.session.query<LeadImportBatchRow>(`
      SELECT * FROM enterprise.marketing_lead_import_batches
      WHERE tenant_id = $1 AND campaign_id = $2
        AND status IN ('committed', 'rolled_back')
      ORDER BY created_at DESC, id
      LIMIT 100
    `, [uuid(campaignId)]);
    return result.rows.map(mapBatch);
  }

  async rollback(input: {
    campaignId: string; batchId: string; expectedVersion: number;
    idempotencyKey: string; requestHash: string; occurredAt: string;
  }) {
    return rollbackEnterpriseLeadImportBatch(this.session, input);
  }

  private async resolveIdentities(rows: ProtectedRow[]) {
    const errors: EnterpriseLeadImportErrorDto[] = [];
    const externalByHash = new Map<string, string | undefined>();
    const hashByExternal = new Map<string, string>();
    for (const row of rows) {
      const priorExternal = externalByHash.get(row.phoneHash);
      if (row.externalId && priorExternal && priorExternal !== row.externalId) {
        errors.push(issue(row.rowNumber, "externalId", "phone_identity_conflict"));
      } else if (row.externalId) externalByHash.set(row.phoneHash, row.externalId);
      else if (!externalByHash.has(row.phoneHash)) externalByHash.set(row.phoneHash, undefined);
      if (row.externalId) {
        const priorHash = hashByExternal.get(row.externalId);
        if (priorHash && priorHash !== row.phoneHash) {
          errors.push(issue(row.rowNumber, "externalId", "external_identity_conflict"));
        } else hashByExternal.set(row.externalId, row.phoneHash);
      }
    }
    if (errors.length > 0) return { errors, byHash: new Map<string, LeadRow>(),
      externalByHash };
    const hashes = [...new Set(rows.map((row) => row.phoneHash))];
    const externalIds = [...new Set(rows.flatMap((row) => row.externalId ?
      [row.externalId] : []))];
    const existing = await this.session.query<LeadRow>(`
      SELECT * FROM enterprise.marketing_leads
      WHERE tenant_id = $1 AND (phone_hash = ANY($2::text[]) OR
        (external_id IS NOT NULL AND external_id = ANY($3::text[])))
      FOR UPDATE
    `, [hashes, externalIds]);
    const byHash = new Map(existing.rows.map((lead) => [lead.phone_hash, lead]));
    const byExternal = new Map(existing.rows.flatMap((lead) => lead.external_id ?
      [[lead.external_id, lead] as const] : []));
    for (const row of rows) {
      const phoneLead = byHash.get(row.phoneHash);
      const externalId = externalByHash.get(row.phoneHash);
      const externalLead = externalId ? byExternal.get(externalId) : undefined;
      if ((externalLead && externalLead.phone_hash !== row.phoneHash) ||
        (phoneLead && externalId && phoneLead.external_id !== externalId)) {
        errors.push(issue(row.rowNumber, "externalId", "lead_identity_conflict"));
      }
    }
    return { errors, byHash, externalByHash };
  }

  private async insertLead(row: ProtectedRow, batchId: string, createdAt: string,
    externalId?: string) {
    const result = await this.session.query<LeadRow>(`
      INSERT INTO enterprise.marketing_leads(
        tenant_id, id, external_id, phone_e164_encrypted, phone_input_encrypted,
        phone_hash, phone_hint, country_code, timezone, language, attributes,
        source_id, status, created_by_batch_id, created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
        NULL, 'active', $12, $13, $13, 1)
      RETURNING *
    `, [uuid(row.id), externalId ?? null, row.phoneE164Encrypted,
      row.phoneInputEncrypted, hash(row.phoneHash), row.phoneHint, row.countryCode,
      row.timezone ?? null, row.language ?? null, JSON.stringify(row.attributes),
      uuid(batchId), iso(createdAt)]);
    if (!result.rows[0]) throw new Error("Lead insert failed");
    return result.rows[0];
  }

  private async reactivateLead(lead: LeadRow, occurredAt: string) {
    const result = await this.session.query<LeadRow>(`
      UPDATE enterprise.marketing_leads
      SET status = 'active', updated_at = GREATEST($3::timestamptz,
        updated_at + interval '1 millisecond'), version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'inactive' AND version = $4
      RETURNING *
    `, [uuid(lead.id), iso(occurredAt), Number(lead.version)]);
    if (!result.rows[0]) throw new Error("Lead reactivation conflict");
    return result.rows[0];
  }

  private async findActiveLink(campaignId: string, leadId: string) {
    const result = await this.session.query<CampaignLeadRow>(`
      SELECT * FROM enterprise.marketing_campaign_leads
      WHERE tenant_id = $1 AND campaign_id = $2 AND lead_id = $3
        AND status = 'active'
      FOR UPDATE
    `, [uuid(campaignId), uuid(leadId)]);
    return result.rows[0] ?? null;
  }

  private async insertLink(campaignId: string, leadId: string, batchId: string,
    createdAt: string) {
    const result = await this.session.query<CampaignLeadRow>(`
      INSERT INTO enterprise.marketing_campaign_leads(
        tenant_id, id, campaign_id, lead_id, import_batch_id, status, linked_by,
        created_at, rolled_back_at, version
      ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, NULL, 1)
      RETURNING *
    `, [randomUUID(), uuid(campaignId), uuid(leadId), uuid(batchId),
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      iso(createdAt)]);
    if (!result.rows[0]) throw new Error("Campaign lead insert failed");
    return result.rows[0];
  }

  private async insertRow(batchId: string, linkId: string, leadId: string,
    countryCode: string, report: EnterpriseLeadImportRowReportDto, createdAt: string) {
    await this.session.query(`
      INSERT INTO enterprise.marketing_lead_import_rows(
        tenant_id, id, batch_id, row_number, result, lead_id, campaign_lead_id,
        phone_hint, country_code, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [randomUUID(), uuid(batchId), report.rowNumber, report.result, uuid(leadId),
      uuid(linkId), report.phoneHint, countryCode, iso(createdAt)]);
  }

  private async listRows(batchId: string) {
    const result = await this.session.query<LeadImportReportRow>(`
      SELECT row_number, result, lead_id, phone_hint
      FROM enterprise.marketing_lead_import_rows
      WHERE tenant_id = $1 AND batch_id = $2
      ORDER BY row_number, id
    `, [uuid(batchId)]);
    return result.rows.map((row) => ({ rowNumber: Number(row.row_number),
      result: row.result, leadId: uuid(row.lead_id), phoneHint: row.phone_hint }));
  }

  private async findBatchByKey(campaignId: string, key: string, lock = false) {
    const result = await this.session.query<LeadImportBatchRow>(`
      SELECT * FROM enterprise.marketing_lead_import_batches
      WHERE tenant_id = $1 AND campaign_id = $2 AND idempotency_key = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(campaignId), eventKey(key)]);
    return result.rows[0] ?? null;
  }

  private async lockTenant() {
    await this.session.queryTenantRecord(`
      SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE
    `);
  }
}
