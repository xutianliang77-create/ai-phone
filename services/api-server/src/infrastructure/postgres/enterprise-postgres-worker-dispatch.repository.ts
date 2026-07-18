import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseWorkerDispatchIssuePostgresRepository,
} from "./enterprise-postgres-worker-dispatch-issue.js";
import {
  EnterpriseWorkerDispatchLifecyclePostgresRepository,
} from "./enterprise-postgres-worker-dispatch-lifecycle.js";

export class EnterpriseWorkerDispatchPostgresRepository {
  private readonly issuer: EnterpriseWorkerDispatchIssuePostgresRepository;
  private readonly lifecycle: EnterpriseWorkerDispatchLifecyclePostgresRepository;

  constructor(session: EnterpriseTenantPostgresSession) {
    this.issuer = new EnterpriseWorkerDispatchIssuePostgresRepository(session);
    this.lifecycle = new EnterpriseWorkerDispatchLifecyclePostgresRepository(session);
  }

  issue(...args: Parameters<EnterpriseWorkerDispatchIssuePostgresRepository["issue"]>) {
    return this.issuer.issue(...args);
  }
  accept(...args: Parameters<EnterpriseWorkerDispatchLifecyclePostgresRepository["accept"]>) {
    return this.lifecycle.accept(...args);
  }
  heartbeat(...args: Parameters<EnterpriseWorkerDispatchLifecyclePostgresRepository["accept"]>) {
    return this.lifecycle.accept(...args);
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
