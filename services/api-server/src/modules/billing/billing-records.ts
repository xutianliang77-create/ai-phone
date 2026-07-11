export type PaymentProvider =
  | "apple_iap"
  | "wechat_pay"
  | "alipay"
  | "android_channel"
  | "sandbox";

export type PaymentOrderStatus = "pending" | "paid" | "failed" | "refunded";

export type PaymentVerificationSource =
  | "sandbox"
  | "storekit_local_dev"
  | "apple_jws"
  | "wechat_pay_callback"
  | "alipay_callback";

export interface PaymentOrderRecord {
  id: string;
  userId: string;
  productId: string;
  provider: PaymentProvider;
  amountCny: number;
  status: PaymentOrderStatus;
  createdAt: string;
  expiresAt?: string;
  paidAt?: string;
  refundedAt?: string;
  providerOrderId?: string;
  transactionId?: string;
  signedTransactionInfo?: string;
  verificationSource?: PaymentVerificationSource;
  failureReason?: string;
  refundReason?: string;
}

export interface BillingLedgerEntry {
  id: string;
  userId: string;
  type: "purchase" | "usage" | "refund";
  source: PaymentProvider | "system";
  deltaSeconds: number;
  balanceAfter: number;
  createdAt: string;
  orderId?: string;
  productId?: string;
  sessionId?: string;
  idempotencyKey?: string;
  note?: string;
}

export interface AppleServerNotificationRecord {
  notificationUUID: string;
  notificationType: string;
  subtype?: string;
  transactionId?: string;
  originalTransactionId?: string;
  orderId?: string;
  action: "ignored" | "duplicate" | "refunded" | "order_not_found";
  receivedAt: string;
}
