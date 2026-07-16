import type {
  EnterpriseProviderCapabilityStatus,
  EnterpriseTenantJobStatus,
} from "@translation/contracts";
import { EnterpriseApiError } from "./api/enterprise-api.js";
import type { PageState } from "./page-state-registry.js";

export type BusinessState = PageState | "ready";

export function providerCapabilityState(
  status: EnterpriseProviderCapabilityStatus,
): BusinessState {
  if (status === "ready") return "ready";
  if (status === "checking") return "processing";
  if (status === "degraded") return "degraded";
  return "not_ready";
}

export function tenantJobState(status: EnterpriseTenantJobStatus): BusinessState {
  if (status === "completed") return "ready";
  return status === "processing" ? "processing" : "failed";
}

export function apiErrorState(error: unknown): PageState {
  if (!(error instanceof EnterpriseApiError)) return "failed";
  if (error.status === 409 || error.status === 412) return "conflict";
  if (error.status === 401 || error.status === 403) return "forbidden";
  if (error.status === 503) return "not_ready";
  return "failed";
}
