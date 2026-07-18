import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseWorkerDispatchIssuePostgresRepository,
} from "./enterprise-postgres-worker-dispatch-issue.js";
import {
  EnterpriseWorkerDispatchLifecyclePostgresRepository,
} from "./enterprise-postgres-worker-dispatch-lifecycle.js";
import { EnterpriseWorkerDispatchLeasePostgresRepository } from
  "./enterprise-postgres-worker-dispatch-lease.js";

export class EnterpriseWorkerDispatchPostgresRepository {
  private readonly issuer: EnterpriseWorkerDispatchIssuePostgresRepository;
  private readonly lifecycle: EnterpriseWorkerDispatchLifecyclePostgresRepository;
  private readonly lease: EnterpriseWorkerDispatchLeasePostgresRepository;

  constructor(session: EnterpriseTenantPostgresSession) {
    this.issuer = new EnterpriseWorkerDispatchIssuePostgresRepository(session);
    this.lifecycle = new EnterpriseWorkerDispatchLifecyclePostgresRepository(session);
    this.lease = new EnterpriseWorkerDispatchLeasePostgresRepository(
      session, this.lifecycle,
    );
  }

  issue(...args: Parameters<EnterpriseWorkerDispatchIssuePostgresRepository["issue"]>) {
    return this.issuer.issue(...args);
  }
  accept(...args: Parameters<EnterpriseWorkerDispatchLifecyclePostgresRepository["accept"]>) {
    return this.lifecycle.accept(...args);
  }
  heartbeat(
    ...args: Parameters<EnterpriseWorkerDispatchLeasePostgresRepository["heartbeat"]>
  ) {
    return this.lease.heartbeat(...args);
  }
  refresh(...args: Parameters<EnterpriseWorkerDispatchLeasePostgresRepository["refresh"]>) {
    return this.lease.refresh(...args);
  }
  authorize(
    ...args: Parameters<EnterpriseWorkerDispatchLifecyclePostgresRepository["authorize"]>
  ) {
    return this.lifecycle.authorize(...args);
  }
  finalize(
    ...args: Parameters<EnterpriseWorkerDispatchLifecyclePostgresRepository["finalize"]>
  ) {
    return this.lifecycle.finalize(...args);
  }
  cancel(...args: Parameters<EnterpriseWorkerDispatchLifecyclePostgresRepository["cancel"]>) {
    return this.lifecycle.cancel(...args);
  }
}
