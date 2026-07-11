import { loadEnv } from "../../config/env.js";
import type { PaymentProvider } from "./billing-records.js";

type DeployablePaymentProvider = Extract<PaymentProvider, "apple_iap" | "wechat_pay" | "alipay">;

export interface ProviderReadiness {
  configured: boolean;
  missingEnv: string[];
  invalidEnv: string[];
}

export function getPaymentDeploymentReadiness() {
  const providerSelection = selectRequiredPaymentProviders();
  const requiredProviders = providerSelection.requiredProviders;
  const domesticRequired = requiredProviders.some(isDomesticPaymentProvider);
  const providers = {
    apple_iap: appleReadiness(),
    wechat_pay: domesticReadiness([
      "WECHAT_PAY_APP_ID",
      "WECHAT_PAY_MCH_ID",
      "WECHAT_PAY_WEBHOOK_SECRET",
    ], "WECHAT_PAY_WEBHOOK_SECRET"),
    alipay: domesticReadiness([
      "ALIPAY_APP_ID",
      "ALIPAY_MERCHANT_ID",
      "ALIPAY_WEBHOOK_SECRET",
    ], "ALIPAY_WEBHOOK_SECRET"),
  } satisfies Record<DeployablePaymentProvider, ProviderReadiness>;
  const callbackBaseUrl = paymentCallbackBaseUrlReadiness(domesticRequired);
  const issues = [
    ...providerSelection.invalidProviders.map(
      (provider) => `payment invalid required provider ${provider}`
    ),
    ...requiredProviders.flatMap((provider) => providerIssues(provider, providers[provider])),
    ...paymentCallbackIssues(callbackBaseUrl),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    requiredProviders,
    providers,
    callbackBaseUrl,
    issues,
  };
}

function selectRequiredPaymentProviders() {
  const configured = process.env.PAYMENT_REQUIRED_PROVIDERS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!configured?.length) {
    return {
      requiredProviders: defaultRequiredProviders(),
      invalidProviders: [],
    };
  }
  return {
    requiredProviders: configured.filter(isDeployablePaymentProvider),
    invalidProviders: configured.filter((provider) => !isDeployablePaymentProvider(provider)),
  };
}

function defaultRequiredProviders(): DeployablePaymentProvider[] {
  return loadEnv().regionEdition === "domestic"
    ? ["apple_iap", "wechat_pay", "alipay"]
    : ["apple_iap"];
}

function appleReadiness(): ProviderReadiness {
  const required = [
    "APPLE_IAP_BUNDLE_ID",
    "APPLE_IAP_ENVIRONMENT",
    "APPLE_IAP_ROOT_CERT_SHA256",
  ];
  const base = envReadiness(required);
  const environment = process.env.APPLE_IAP_ENVIRONMENT;
  if (environment && !["Sandbox", "Production"].includes(environment)) {
    base.invalidEnv.push("APPLE_IAP_ENVIRONMENT");
  }
  const fingerprint = normalizeFingerprint(process.env.APPLE_IAP_ROOT_CERT_SHA256 ?? "");
  if (fingerprint && fingerprint.length !== 64) {
    base.invalidEnv.push("APPLE_IAP_ROOT_CERT_SHA256");
  }
  base.configured = base.missingEnv.length === 0 && base.invalidEnv.length === 0;
  return base;
}

function envReadiness(keys: string[]): ProviderReadiness {
  const missingEnv = keys.filter((key) => !process.env[key]);
  return {
    configured: missingEnv.length === 0,
    missingEnv,
    invalidEnv: [],
  };
}

function domesticReadiness(keys: string[], secretKey: string): ProviderReadiness {
  const base = envReadiness(keys);
  const secret = process.env[secretKey];
  if (secret && secret.length < 32) base.invalidEnv.push(secretKey);
  base.configured = base.missingEnv.length === 0 && base.invalidEnv.length === 0;
  return base;
}

function paymentCallbackBaseUrlReadiness(required: boolean): ProviderReadiness {
  if (!required) return { configured: true, missingEnv: [], invalidEnv: [] };
  const key = "PAYMENT_CALLBACK_BASE_URL";
  const value = process.env[key];
  if (!value) return { configured: false, missingEnv: [key], invalidEnv: [] };
  const invalidEnv: string[] = [];
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") invalidEnv.push(`${key}:https_required`);
    if (isLocalHost(parsed.hostname)) invalidEnv.push(`${key}:public_host_required`);
  } catch {
    invalidEnv.push(key);
  }
  return {
    configured: invalidEnv.length === 0,
    missingEnv: [],
    invalidEnv,
  };
}

function providerIssues(provider: DeployablePaymentProvider, readiness: ProviderReadiness) {
  return [
    ...readiness.missingEnv.map((key) => `${provider} missing ${key}`),
    ...readiness.invalidEnv.map((key) => `${provider} invalid ${key}`),
  ];
}

function paymentCallbackIssues(readiness: ProviderReadiness) {
  return [
    ...readiness.missingEnv.map((key) => `payment callback missing ${key}`),
    ...readiness.invalidEnv.map((key) => `payment callback invalid ${key}`),
  ];
}

function normalizeFingerprint(value: string) {
  return value.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

function isDeployablePaymentProvider(value: string): value is DeployablePaymentProvider {
  return value === "apple_iap" || value === "wechat_pay" || value === "alipay";
}

function isDomesticPaymentProvider(value: DeployablePaymentProvider) {
  return value === "wechat_pay" || value === "alipay";
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1";
}
