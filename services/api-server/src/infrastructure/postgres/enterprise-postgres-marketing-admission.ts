import { createHash } from "node:crypto";
import { deterministicEnterpriseGrantId } from
  "./enterprise-postgres-tenant-admission.js";

export function marketingAdmissionId(
  tenantId: string,
  taskId: string,
  generation: number,
) {
  return deterministicEnterpriseGrantId({ tenantId, capability: "marketing_pstn",
    idempotencyKey: `marketing-admission:${taskId}:g${generation}` });
}
export function marketingAdmissionOwner(taskId: string) {
  return `marketing-pstn:${taskId}`;
}
export function marketingAdmissionHash(taskId: string, generation: number) {
  return createHash("sha256").update(JSON.stringify([
    "marketing-pstn-admission-v1", taskId, generation,
  ])).digest("hex");
}
