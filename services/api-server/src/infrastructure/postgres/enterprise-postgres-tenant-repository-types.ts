import type {
  EnterpriseAuditResult,
  EnterpriseMemberRole,
  EnterpriseMemberStatus,
} from "@translation/contracts";
import type {
  EnterpriseAuditEventRecord,
  EnterpriseMemberRecord,
  EnterpriseTenantRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";

export interface EnterprisePostgresAuditPosition {
  createdAt: string;
  id: string;
}

export interface EnterpriseTenantPostgresRepository {
  insertTenant(tenant: EnterpriseTenantRecord): Promise<
    | { status: "created"; tenant: EnterpriseTenantRecord }
    | { status: "already_exists" }
  >;
  findTenant(options?: { lock?: boolean }): Promise<EnterpriseTenantRecord | null>;
  listMembers(): Promise<EnterpriseMemberRecord[]>;
  findMemberById(
    memberId: string,
    options?: { lock?: boolean },
  ): Promise<EnterpriseMemberRecord | null>;
  findMemberByUserId(userId: string): Promise<EnterpriseMemberRecord | null>;
  insertMember(member: EnterpriseMemberRecord): Promise<
    | { status: "created"; member: EnterpriseMemberRecord }
    | { status: "already_exists" }
  >;
  updateMember(input: {
    memberId: string;
    expectedVersion: number;
    role?: EnterpriseMemberRole;
    status?: EnterpriseMemberStatus;
    updatedAt: string;
  }): Promise<
    | { status: "updated"; member: EnterpriseMemberRecord }
    | { status: "not_found" }
    | { status: "owner_protected"; member: EnterpriseMemberRecord }
    | { status: "conflict" }
  >;
  appendAuditEvent(event: EnterpriseAuditEventRecord): Promise<void>;
  listAuditEvents(input: {
    limit: number;
    action?: string;
    resourceType?: string;
    result?: EnterpriseAuditResult;
    before?: EnterprisePostgresAuditPosition;
  }): Promise<{
    events: EnterpriseAuditEventRecord[];
    nextPosition?: EnterprisePostgresAuditPosition;
  }>;
}
