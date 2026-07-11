import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import type { PaymentProvider } from "./billing-records.js";
import { handleAppleServerNotification } from "./apple-server-notifications.js";
import {
  confirmPaymentOrder,
  createPaymentOrder,
  getBillingLedger,
  getBillingProducts,
  refundPaymentOrder,
} from "./billing.service.js";
import { handleDomesticPaymentNotification } from "./domestic-payment-notifications.js";

export async function registerBillingRoutes(app: FastifyInstance) {
  app.get("/billing/products", async () => getBillingProducts());

  app.get("/billing/ledger", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    return getBillingLedger(account.id);
  });

  app.post("/billing/orders", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const body = request.body as Partial<{
      productId: string;
      provider: PaymentProvider;
    }>;
    if (typeof body.productId !== "string" || !isPaymentProvider(body.provider)) {
      return sendError(reply, 400, "invalid_payment_order", "Invalid payment order");
    }

    const result = createPaymentOrder({
      userId: account.id,
      productId: body.productId,
      provider: body.provider,
    });
    if (!result.ok) return sendResultError(reply, result);
    return result;
  });

  app.post("/billing/orders/:orderId/confirm", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { orderId: string };
    const body = request.body as Partial<{
      transactionId: string;
      signedTransactionInfo: string;
    }>;
    if (typeof body.transactionId !== "string") {
      return sendError(reply, 400, "invalid_payment_confirmation", "Invalid payment confirmation");
    }

    const result = confirmPaymentOrder({
      userId: account.id,
      orderId: params.orderId,
      transactionId: body.transactionId,
      signedTransactionInfo: body.signedTransactionInfo,
    });
    if (!result.ok) return sendError(reply, 400, result.code, result.code);
    return result;
  });

  app.post("/billing/orders/:orderId/refund", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { orderId: string };
    const body = (request.body ?? {}) as Partial<{ reason: string }>;
    const result = refundPaymentOrder({
      userId: account.id,
      orderId: params.orderId,
      reason: body.reason,
    });
    if (!result.ok) return sendError(reply, 400, result.code, result.code);
    return result;
  });

  app.post("/billing/apple/notifications", async (request, reply) => {
    const body = request.body as Partial<{ signedPayload: string }>;
    if (typeof body.signedPayload !== "string") {
      return sendError(reply, 400, "invalid_apple_notification", "Invalid Apple notification");
    }
    const result = handleAppleServerNotification({ signedPayload: body.signedPayload });
    if (!result.ok) return sendResultError(reply, result);
    return result;
  });

  app.post("/billing/wechat/notifications", async (request, reply) => {
    const result = handleDomesticPaymentNotification({
      provider: "wechat_pay",
      body: request.body,
    });
    if (!result.ok) return sendResultError(reply, result);
    return result;
  });

  app.post("/billing/alipay/notifications", async (request, reply) => {
    const result = handleDomesticPaymentNotification({
      provider: "alipay",
      body: request.body,
    });
    if (!result.ok) return sendResultError(reply, result);
    return result;
  });
}

function isPaymentProvider(value: unknown): value is PaymentProvider {
  return value === "apple_iap" ||
    value === "wechat_pay" ||
    value === "alipay" ||
    value === "android_channel" ||
    value === "sandbox";
}

function sendResultError(
  reply: Parameters<typeof sendError>[0],
  result: { code: string; retryable?: boolean },
) {
  return sendError(reply, result.retryable ? 503 : 400, result.code, result.code);
}
