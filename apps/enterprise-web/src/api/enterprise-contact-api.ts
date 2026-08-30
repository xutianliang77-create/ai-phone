import type {
  EnterpriseCustomerDirectoryDetailResponse,
  EnterpriseCustomerDirectoryResponse,
  EnterpriseLeadDirectoryDetailResponse,
  EnterpriseLeadDirectoryResponse,
} from "@translation/contracts";
import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type EnterpriseRequester = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface EnterpriseContactApi {
  listEnterpriseLeads(
    context: EnterpriseContentRequestContext,
    input?: { cursor?: string; limit?: number },
  ): Promise<EnterpriseLeadDirectoryResponse>;
  getEnterpriseLead(
    context: EnterpriseContentRequestContext,
    leadId: string,
  ): Promise<EnterpriseLeadDirectoryDetailResponse>;
  listEnterpriseCustomers(
    context: EnterpriseContentRequestContext,
    input?: { cursor?: string; limit?: number },
  ): Promise<EnterpriseCustomerDirectoryResponse>;
  getEnterpriseCustomer(
    context: EnterpriseContentRequestContext,
    customerId: string,
  ): Promise<EnterpriseCustomerDirectoryDetailResponse>;
}

export function createEnterpriseContactApi(
  request: EnterpriseRequester,
  headers: (context: EnterpriseContentRequestContext) => Record<string, string>,
): EnterpriseContactApi {
  return {
    listEnterpriseLeads: (context, input) => request(
      `/enterprise/v1/leads${query(input)}`,
      { headers: headers(context) },
    ),
    getEnterpriseLead: (context, leadId) => request(
      `/enterprise/v1/leads/${encodeURIComponent(leadId)}`,
      { headers: headers(context) },
    ),
    listEnterpriseCustomers: (context, input) => request(
      `/enterprise/v1/customers${query(input)}`,
      { headers: headers(context) },
    ),
    getEnterpriseCustomer: (context, customerId) => request(
      `/enterprise/v1/customers/${encodeURIComponent(customerId)}`,
      { headers: headers(context) },
    ),
  };
}

function query(input: { cursor?: string; limit?: number } | undefined) {
  const params = new URLSearchParams();
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.limit !== undefined) params.set("limit", String(input.limit));
  const value = params.toString();
  return value ? `?${value}` : "";
}
