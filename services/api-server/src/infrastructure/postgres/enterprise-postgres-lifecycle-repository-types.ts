import type {
  EnterpriseTenantStatus,
} from "@translation/contracts";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantJobRecord,
  EnterpriseTenantRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";

export interface EnterpriseLifecyclePostgresRepository {
  insertJob(job: EnterpriseTenantJobRecord): Promise<
    | { status: "created"; job: EnterpriseTenantJobRecord }
    | { status: "already_exists"; job: EnterpriseTenantJobRecord }
  >;
  findJob(jobId: string): Promise<EnterpriseTenantJobRecord | null>;
  findJobByIdempotency(
    type: EnterpriseTenantJobRecord["type"],
    idempotencyKey: string,
  ): Promise<EnterpriseTenantJobRecord | null>;
  listJobs(): Promise<EnterpriseTenantJobRecord[]>;
  hasProcessingJob(type: EnterpriseTenantJobRecord["type"]): Promise<boolean>;
  lockJob(jobId: string): Promise<EnterpriseTenantJobRecord | null>;
  claimJob(input: {
    jobId: string;
    now: string;
    leaseExpiresAt: string;
    force?: boolean;
  }): Promise<
    | { status: "claimed"; job: EnterpriseTenantJobRecord }
    | { status: "busy" }
  >;
  listRecoverableJobs(input: {
    now: string;
    limit: number;
  }): Promise<EnterpriseTenantJobRecord[]>;
  updateJob(input: {
    job: EnterpriseTenantJobRecord;
    expectedUpdatedAt: string;
  }): Promise<
    | { status: "updated"; job: EnterpriseTenantJobRecord }
    | { status: "conflict" }
  >;
  updateTenantStatus(input: {
    status: EnterpriseTenantStatus;
    expectedVersion: number;
    updatedAt: string;
    cellId?: string;
  }): Promise<
    | { status: "updated"; tenant: EnterpriseTenantRecord }
    | { status: "conflict" }
  >;
  suspendMembers(updatedAt: string): Promise<
    | { status: "updated"; members: EnterpriseMemberRecord[] }
    | { status: "unchanged"; members: [] }
  >;
}
