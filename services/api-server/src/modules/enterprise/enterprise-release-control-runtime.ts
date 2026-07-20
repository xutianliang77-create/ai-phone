import type {
  EnterpriseReleaseCapability,
  EnterpriseReleaseDecisionDto,
} from "@translation/contracts";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  EnterpriseReleaseControlChange,
  EnterpriseReleaseControlRecord,
  EnterpriseReleaseOutcome,
} from "./enterprise-release-control.js";

export interface EnterpriseReleaseControlRuntime {
  listReleaseControls?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; controls: EnterpriseReleaseControlRecord[] }
    | { status: "storage_required" }
  >;
  evaluateReleaseControl?(input: {
    context: EnterpriseTenantContext;
    capability: EnterpriseReleaseCapability;
    now: string;
    probe?: boolean;
  }): Promise<
    | { status: "ready"; decision: EnterpriseReleaseDecisionDto }
    | { status: "storage_required" }
  >;
  changeReleaseControl?(input: EnterpriseReleaseControlChange): Promise<
    | { status: "updated"; control: EnterpriseReleaseControlRecord }
    | { status: "conflict" | "invalid_transition" | "already_recorded" }
    | { status: "storage_required" }
  >;
  recordReleaseOutcome?(input: EnterpriseReleaseOutcome): Promise<
    | { status: "updated"; control: EnterpriseReleaseControlRecord }
    | { status: "unchanged"; control: EnterpriseReleaseControlRecord }
    | { status: "invalid_state" | "already_recorded" | "not_found" }
    | { status: "storage_required" }
  >;
}
