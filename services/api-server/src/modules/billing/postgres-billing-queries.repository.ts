import type { Pool, QueryResultRow } from "pg";
import { PostgresPrimaryStore } from
  "../../infrastructure/storage/postgres-primary-store.js";
import type {
  PostgresBillingEntitlementRecord,
  PostgresPaymentOrderRecord,
} from "./postgres-billing-records.js";
import {
  requireBillingEntitlement,
  requirePaymentOrder,
} from "./postgres-billing-uow.js";

export class PostgresBillingQueriesRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async findOrder(orderId: string) {
    const primary = await this.primary.read<PostgresPaymentOrderRecord>(
      "paymentOrders", orderId,
    );
    return primary ? requirePaymentOrder(primary.payload, orderId) : null;
  }

  async findOrderByProviderReference(input: {
    provider: string;
    providerOrderId?: string;
    transactionId?: string;
  }) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<IdRow>(`
        SELECT id FROM ai_phone.payment_orders
        WHERE provider = $1 AND (($2::text IS NOT NULL AND provider_order_id = $2)
          OR ($3::text IS NOT NULL AND transaction_id = $3))
        ORDER BY created_at DESC LIMIT 1
      `, [input.provider, input.providerOrderId ?? null, input.transactionId ?? null]);
      return result.rows[0] ? this.findOrder(result.rows[0].id) : null;
    } finally {
      client.release();
    }
  }

  async findEntitlement(userId: string) {
    const primary = await this.primary.read<PostgresBillingEntitlementRecord>(
      "billingEntitlements", userId,
    );
    return primary ? requireBillingEntitlement(primary.payload, userId) : null;
  }
}

interface IdRow extends QueryResultRow { id: string }
