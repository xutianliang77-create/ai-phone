import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  errorMessage,
  openPort,
  requestJson,
  startNpmWorkspaceService,
  stopServices,
  waitForHttpService,
} from "./script_service_utils.mjs";

const PRODUCT_ID = "domestic_credits_60m";
const WECHAT_SECRET = "wx_secret_012345678901234567890123";
const ALIPAY_SECRET = "ali_secret_01234567890123456789012";

export async function buildDomesticPaymentCallbacksConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const apiPort = Number(options.apiPort ?? await openPort());
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/domestic-payment-callbacks");
  return {
    root,
    apiPort,
    apiBaseUrl: `http://127.0.0.1:${apiPort}`,
    cacheDir,
    dataFile: path.join(cacheDir, "api-store.json"),
    timeoutMs: Number(options.timeoutMs ?? 60000),
    logs: { api: path.join(cacheDir, "api-server.log") },
    apiEnv: {
      REGION_EDITION: "domestic",
      DATA_REGION: "cn",
      COMPLIANCE_PROFILE: "pipl",
      API_PORT: String(apiPort),
      API_DATA_FILE: path.join(cacheDir, "api-store.json"),
      ACTIVE_PLAN_CODE: "free",
      PAYMENT_CALLBACK_BASE_URL: "https://api.example.cn",
      WECHAT_PAY_APP_ID: "wx_app_smoke",
      WECHAT_PAY_MCH_ID: "wx_mch_smoke",
      WECHAT_PAY_WEBHOOK_SECRET: WECHAT_SECRET,
      ALIPAY_APP_ID: "ali_app_smoke",
      ALIPAY_MERCHANT_ID: "ali_mch_smoke",
      ALIPAY_WEBHOOK_SECRET: ALIPAY_SECRET,
    },
  };
}

export async function checkDomesticPaymentCallbacksReadiness(options = {}) {
  const config = await buildDomesticPaymentCallbacksConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.dataFile, { force: true });
  rmSync(config.logs.api, { force: true });
  let api = null;
  const checks = [];
  const issues = [];
  const actions = [];

  try {
    api = startNpmWorkspaceService({
      root: config.root,
      logPath: config.logs.api,
      name: "api",
      script: "dev",
      workspace: "@translation/api-server",
      env: config.apiEnv,
    });
    await waitForHttpService({
      label: "api",
      service: api,
      url: `${config.apiBaseUrl}/health`,
      timeoutMs: config.timeoutMs,
    });
    await probeDomesticPaymentCallbacks({ ...options, config, checks, issues, actions });
  } catch (error) {
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
    issues.push(errorMessage(error));
    actions.push(`Inspect API log at ${config.logs.api}.`);
  } finally {
    await stopServices([api].filter(Boolean));
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    apiBaseUrl: config.apiBaseUrl,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

export async function probeDomesticPaymentCallbacks(options) {
  const { config, checks, issues, actions } = options;
  const health = await requestJson(`${config.apiBaseUrl}/health`, options);
  record(checks, "api_service_identity", health.status === 200 &&
    health.body?.service === "api-server", {
    httpStatus: health.status,
    service: health.body?.service,
  });

  const wechat = await runPaidCallback({
    ...options,
    provider: "wechat_pay",
    channel: "wechat",
    tradeStatus: "SUCCESS",
    transactionId: "wx_txn_smoke_1",
    expectedSource: "wechat_pay_callback",
  });
  const duplicate = await postCallback({
    ...options,
    channel: "wechat",
    payload: wechat.payload,
  });
  const duplicateOk = duplicate.body?.action === "duplicate";
  record(checks, "wechat_callback_deduplicates_transaction", duplicateOk, {
    httpStatus: duplicate.status,
    action: duplicate.body?.action,
  });

  await runInvalidSignatureProbe(options);
  await runPaidCallback({
    ...options,
    provider: "alipay",
    channel: "alipay",
    tradeStatus: "TRADE_SUCCESS",
    transactionId: "ali_txn_smoke_1",
    expectedSource: "alipay_callback",
  });

  const balance = await requestJson(`${config.apiBaseUrl}/usage/balance`, options);
  const ledger = await requestJson(`${config.apiBaseUrl}/billing/ledger`, options);
  const finalOk = balance.body?.remainingSeconds === 7500 && ledger.body?.ledger?.length === 2;
  record(checks, "domestic_payment_balance_and_ledger_updated", finalOk, {
    remainingSeconds: balance.body?.remainingSeconds,
    ledgerCount: ledger.body?.ledger?.length,
  });
  if (!checks.every((check) => check.status === "pass")) {
    issues.push("Domestic payment callback smoke did not complete all payment checks.");
    actions.push("Inspect signed callback payloads and API billing ledger.");
  }
}

async function runPaidCallback(options) {
  const created = await createOrder(options, options.provider);
  const createdOk = created.status === 200 &&
    created.body?.paymentIntent?.provider === options.provider &&
    created.body?.paymentIntent?.signature;
  record(options.checks, `${options.channel}_payment_intent_created`, createdOk, {
    httpStatus: created.status,
    provider: created.body?.paymentIntent?.provider,
    notifyUrl: created.body?.paymentIntent?.notifyUrl,
  });
  const payload = signedCallback(options.provider, created.body, options.tradeStatus, options.transactionId);
  const paid = await postCallback({ ...options, payload });
  const paidOk = paid.status === 200 &&
    paid.body?.action === "paid" &&
    paid.body?.order?.verificationSource === options.expectedSource;
  record(options.checks, `${options.channel}_signed_callback_paid`, paidOk, {
    httpStatus: paid.status,
    action: paid.body?.action,
    verificationSource: paid.body?.order?.verificationSource,
  });
  return { created, paid, payload };
}

async function runInvalidSignatureProbe(options) {
  const created = await createOrder(options, "wechat_pay");
  const payload = signedCallback("wechat_pay", created.body, "SUCCESS", "wx_txn_bad_signature");
  const rejected = await postCallback({
    ...options,
    channel: "wechat",
    payload: { ...payload, signature: "bad" },
    allowError: true,
  });
  const ok = rejected.status === 400 &&
    rejected.body?.error?.code === "payment_verification_failed";
  record(options.checks, "wechat_invalid_signature_rejected", ok, {
    httpStatus: rejected.status,
    errorCode: rejected.body?.error?.code,
  });
}

function createOrder(options, provider) {
  return requestJson(`${options.config.apiBaseUrl}/billing/orders`, {
    ...options,
    method: "POST",
    body: { productId: PRODUCT_ID, provider },
  });
}

function postCallback(options) {
  return requestJson(`${options.config.apiBaseUrl}/billing/${options.channel}/notifications`, {
    ...options,
    method: "POST",
    body: options.payload,
    allowError: options.allowError,
  });
}

export function signedCallback(provider, created, tradeStatus, transactionId) {
  const secret = provider === "wechat_pay" ? WECHAT_SECRET : ALIPAY_SECRET;
  const body = {
    amountCny: created.paymentIntent.amountCny,
    orderId: created.order.id,
    providerOrderId: created.paymentIntent.providerOrderId,
    tradeStatus,
    transactionId,
  };
  return {
    ...body,
    signature: signDomesticPaymentFields(secret, {
      amountCny: String(body.amountCny),
      orderId: body.orderId,
      provider,
      providerOrderId: body.providerOrderId,
      tradeStatus,
      transactionId,
    }),
  };
}

function signDomesticPaymentFields(secret, fields) {
  const canonical = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join("&");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
