import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseEntitlementResolutionPostgresRepository,
} from "./enterprise-postgres-entitlement-resolution.js";
import {
  EnterpriseSubscriptionChangePostgresRepository,
} from "./enterprise-postgres-subscription-change.js";
import {
  EnterpriseBillingAccountPostgresRepository,
} from "./enterprise-postgres-billing-account.js";

export class EnterpriseBillingEntitlementPostgresRepository {
  readonly resolution: EnterpriseEntitlementResolutionPostgresRepository;
  readonly subscriptions: EnterpriseSubscriptionChangePostgresRepository;
  readonly accounts: EnterpriseBillingAccountPostgresRepository;

  constructor(session: EnterpriseTenantPostgresSession) {
    this.resolution = new EnterpriseEntitlementResolutionPostgresRepository(session);
    this.subscriptions = new EnterpriseSubscriptionChangePostgresRepository(session);
    this.accounts = new EnterpriseBillingAccountPostgresRepository(session);
  }

  current(...args: Parameters<EnterpriseEntitlementResolutionPostgresRepository["current"]>) {
    return this.resolution.current(...args);
  }
  resolveDispatch(
    ...args: Parameters<EnterpriseEntitlementResolutionPostgresRepository["resolveDispatch"]>
  ) {
    return this.resolution.resolveDispatch(...args);
  }
  ensureAccount(
    ...args: Parameters<EnterpriseBillingAccountPostgresRepository["ensure"]>
  ) {
    return this.accounts.ensure(...args);
  }
  change(...args: Parameters<EnterpriseSubscriptionChangePostgresRepository["change"]>) {
    return this.subscriptions.change(...args);
  }
}
