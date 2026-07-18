import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseCommunicationPolicyResolutionPostgresRepository,
} from "./enterprise-postgres-communication-policy-resolution.js";
import {
  EnterpriseCommunicationPolicyWritePostgresRepository,
} from "./enterprise-postgres-communication-policy-write.js";

export class EnterpriseCommunicationPolicyPostgresRepository {
  private readonly writer: EnterpriseCommunicationPolicyWritePostgresRepository;
  private readonly resolver:
    EnterpriseCommunicationPolicyResolutionPostgresRepository;

  constructor(session: EnterpriseTenantPostgresSession) {
    this.writer = new EnterpriseCommunicationPolicyWritePostgresRepository(session);
    this.resolver = new EnterpriseCommunicationPolicyResolutionPostgresRepository(
      session,
    );
  }

  publish(...args: Parameters<
    EnterpriseCommunicationPolicyWritePostgresRepository["publish"]
  >) {
    return this.writer.publish(...args);
  }

  recordAuthorization(...args: Parameters<
    EnterpriseCommunicationPolicyWritePostgresRepository["recordAuthorization"]
  >) {
    return this.writer.recordAuthorization(...args);
  }

  revokeAuthorization(...args: Parameters<
    EnterpriseCommunicationPolicyWritePostgresRepository["revokeAuthorization"]
  >) {
    return this.writer.revokeAuthorization(...args);
  }

  resolve(...args: Parameters<
    EnterpriseCommunicationPolicyResolutionPostgresRepository["resolve"]
  >) {
    return this.resolver.resolve(...args);
  }
}
