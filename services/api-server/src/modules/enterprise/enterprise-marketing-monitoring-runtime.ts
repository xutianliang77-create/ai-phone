import type {
  EnterpriseMarketingMonitoringCallResponse,
  EnterpriseMarketingMonitoringSnapshotResponse,
} from "@translation/contracts";
import type { EnterpriseTenantContext } from
  "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingMonitoringRepositoryRuntime {
  getMarketingMonitoringSnapshot?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    now: Date;
  }): Promise<
    | { status: "ready"; snapshot: EnterpriseMarketingMonitoringSnapshotResponse }
    | { status: "not_found" }
    | StorageRequired
  >;
  getMarketingMonitoringCall?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    dispatchId: string;
    now: Date;
  }): Promise<
    | { status: "ready"; detail: EnterpriseMarketingMonitoringCallResponse }
    | { status: "not_found" }
    | StorageRequired
  >;
}
