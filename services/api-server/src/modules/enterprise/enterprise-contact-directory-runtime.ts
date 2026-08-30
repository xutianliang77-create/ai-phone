import type {
  EnterpriseCustomerDirectoryDetailResponse,
  EnterpriseCustomerDirectoryItemDto,
  EnterpriseLeadDirectoryItemDto,
} from "@translation/contracts";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type { EnterpriseContactDirectoryPosition } from
  "./enterprise-contact-directory.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseContactDirectoryRepositoryRuntime {
  listEnterpriseLeads?(input: {
    context: EnterpriseTenantContext;
    limit: number;
    before?: EnterpriseContactDirectoryPosition;
    evaluatedAt: string;
  }): Promise<
    | { status: "ready"; leads: EnterpriseLeadDirectoryItemDto[];
        nextPosition?: EnterpriseContactDirectoryPosition }
    | StorageRequired
  >;
  getEnterpriseLead?(input: {
    context: EnterpriseTenantContext;
    leadId: string;
    evaluatedAt: string;
  }): Promise<
    | { status: "ready"; lead: EnterpriseLeadDirectoryItemDto }
    | { status: "not_found" }
    | StorageRequired
  >;
  listEnterpriseCustomers?(input: {
    context: EnterpriseTenantContext;
    limit: number;
    before?: EnterpriseContactDirectoryPosition;
  }): Promise<
    | { status: "ready"; customers: EnterpriseCustomerDirectoryItemDto[];
        nextPosition?: EnterpriseContactDirectoryPosition }
    | StorageRequired
  >;
  getEnterpriseCustomer?(input: {
    context: EnterpriseTenantContext;
    customerId: string;
  }): Promise<
    | ({ status: "ready" } & EnterpriseCustomerDirectoryDetailResponse)
    | { status: "not_found" }
    | StorageRequired
  >;
}
