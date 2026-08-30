import type { EnterpriseWorkerCapability } from
  "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import { EnterpriseTenantAdmissionPostgresRepository } from
  "./enterprise-postgres-tenant-admission.js";

export type EnterpriseDispatchAdmissionReject =
  | { status: "admission_queued"; queuePosition: number; retryAfterMs: number }
  | { status: "admission_queue_full"; retryAfterMs: number }
  | { status: "admission_not_ready" | "admission_conflict" |
      "admission_terminal" };

export async function reserveEnterpriseWorkerDispatchAdmission(input: {
  session: EnterpriseTenantPostgresSession;
  capability: EnterpriseWorkerCapability;
  grantId: string;
  idempotencyKey: string;
  requestHash: string;
  tenantLimit: number;
  leaseExpiresAt: string;
  now: string;
}): Promise<EnterpriseDispatchAdmissionReject | null> {
  const admission = await new EnterpriseTenantAdmissionPostgresRepository(
    input.session,
  ).reserve(input);
  if (admission.status === "admitted") return null;
  if (admission.status === "queued") {
    return { status: "admission_queued",
      queuePosition: admission.queuePosition,
      retryAfterMs: admission.retryAfterMs };
  }
  if (admission.status === "queue_full") {
    return { status: "admission_queue_full",
      retryAfterMs: admission.retryAfterMs };
  }
  return { status: `admission_${admission.status}` as
    "admission_not_ready" | "admission_conflict" | "admission_terminal" };
}
