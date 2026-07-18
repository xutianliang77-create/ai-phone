import type {
  CreateEnterpriseAuditExportRequest,
  EnterpriseAuditEventsResponse,
  EnterpriseAuditExportResponse,
  EnterpriseAuditExportsResponse,
  EnterpriseAuditResult,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";
import type { EnterpriseBinaryResponse } from "./enterprise-request.js";

type EnterpriseRequester = <T>(path: string, init?: RequestInit) => Promise<T>;
type EnterpriseBinaryRequester = (
  path: string,
  init?: RequestInit,
) => Promise<EnterpriseBinaryResponse>;

export interface EnterpriseAuditQuery {
  action?: string;
  resourceType?: string;
  result?: EnterpriseAuditResult;
  limit?: number;
  cursor?: string;
}

export interface EnterpriseAuditApi {
  listAuditEvents(
    context: EnterpriseContentRequestContext,
    query?: EnterpriseAuditQuery,
  ): Promise<EnterpriseAuditEventsResponse>;
  listAuditExports(
    context: EnterpriseContentRequestContext,
  ): Promise<EnterpriseAuditExportsResponse>;
  createAuditExport(
    context: EnterpriseContentRequestContext,
    input: Omit<CreateEnterpriseAuditExportRequest, "tenantId">,
    idempotencyKey: string,
  ): Promise<EnterpriseAuditExportResponse>;
  downloadAuditExport(
    context: EnterpriseContentRequestContext,
    exportId: string,
  ): Promise<EnterpriseBinaryResponse>;
}

export function createEnterpriseAuditApi(
  request: EnterpriseRequester,
  binaryRequest: EnterpriseBinaryRequester,
  headers: (context: EnterpriseContentRequestContext) => Record<string, string>,
): EnterpriseAuditApi {
  return {
    listAuditEvents: (context, query = {}) => request(
      `/enterprise/v1/audit-events${queryString(query)}`,
      { headers: headers(context) },
    ),
    listAuditExports: (context) => request("/enterprise/v1/audit-exports", {
      headers: headers(context),
    }),
    createAuditExport: (context, input, idempotencyKey) => request(
      "/enterprise/v1/audit-exports",
      {
        method: "POST",
        headers: { ...headers(context), "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      },
    ),
    downloadAuditExport: (context, exportId) => binaryRequest(
      `/enterprise/v1/audit-exports/${encodeURIComponent(exportId)}/download`,
      { headers: headers(context) },
    ),
  };
}

function queryString(query: EnterpriseAuditQuery) {
  const params = new URLSearchParams();
  if (query.action) params.set("action", query.action);
  if (query.resourceType) params.set("resourceType", query.resourceType);
  if (query.result) params.set("result", query.result);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const value = params.toString();
  return value ? `?${value}` : "";
}
