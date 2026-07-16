import { createHash } from "node:crypto";
import {
  getStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type {
  EnterpriseTenantRecord,
} from "./enterprise-tenant-record.js";

export function hashRequest(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function validCellId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(value);
}

export function safeErrorCode(value: string) {
  return /^[a-z][a-z0-9_]{1,63}$/.test(value)
    ? value
    : "provisioning_not_ready";
}

export function allowsLifecycleAction(tenant: EnterpriseTenantRecord) {
  return tenant.status === "active" || tenant.status === "suspended";
}

export function hasProcessingTenantExport(tenantId: string) {
  return getStoreSnapshot().enterpriseTenantJobs.some((job) =>
    job.tenantId === tenantId &&
    job.type === "tenant.export" &&
    job.status === "processing"
  );
}
