import type { PaymentOrderRecord, PaymentProvider } from "./billing-records.js";

export interface PostgresPaymentOrderRecord extends
  Omit<PaymentOrderRecord, "signedTransactionInfo"> {
  idempotencyKey: string;
  requestHash: string;
  version: number;
}

export interface PostgresBillingEntitlementRecord {
  userId: string;
  planCode: string;
  status: "active" | "revoked";
  sourceOrderId?: string;
  version: number;
  effectiveAt: string;
  updatedAt: string;
}

export interface PostgresBillingNotificationRecord {
  id: string;
  provider: PaymentProvider;
  notificationType: string;
  action: string;
  orderId?: string;
  transactionId?: string;
  requestHash: string;
  receivedAt: string;
}
