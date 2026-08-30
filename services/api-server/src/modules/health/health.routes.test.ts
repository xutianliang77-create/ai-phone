import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  captureEnv,
  clearEnv,
  configureAccountEnv,
  configureCallRoomEnv,
  configureDiagnosticsEnv,
  configurePaymentEnv,
  configureSmsEnv,
  restoreEnv,
} from "./health-readiness-test-helpers.js";
import {
  readyManifest,
  writeManifest,
} from "./release-materials-readiness-test-helpers.js";
import { configureEnterpriseReleaseMaterialsEnv } from
  "./enterprise-release-materials-readiness-test-helpers.js";

describe("health routes", () => {
  let previousEnv: Record<string, string | undefined>;
  const tempDirs: string[] = [];

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
    getStoreSnapshot().appErrorReports = [];
  });

  afterEach(() => {
    restoreEnv(previousEnv);
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { force: true, recursive: true });
    }
  });

  it("fails deployment readiness when payment providers are not configured", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe("not_ready");
    expect(response.json().paymentReadiness.issues).toContain(
      "apple_iap missing APPLE_IAP_BUNDLE_ID",
    );
    expect(response.json().paymentReadiness.issues).toContain(
      "wechat_pay missing WECHAT_PAY_APP_ID",
    );
    expect(response.json().service).toBe("api-server");
  });

  it("fails deployment readiness when required payment providers are invalid", async () => {
    process.env.PAYMENT_REQUIRED_PROVIDERS = "apple_iap,bogus_provider";
    configurePaymentEnv();
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().paymentReadiness.issues).toContain(
      "payment invalid required provider bogus_provider",
    );
  });

  it("fails deployment readiness when domestic callback URL is missing", async () => {
    configurePaymentEnv();
    delete process.env.PAYMENT_CALLBACK_BASE_URL;
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().paymentReadiness.issues).toContain(
      "payment callback missing PAYMENT_CALLBACK_BASE_URL",
    );
  });

  it("fails deployment readiness for local domestic callback URLs and short secrets", async () => {
    configurePaymentEnv();
    process.env.PAYMENT_CALLBACK_BASE_URL = "http://127.0.0.1:3000";
    process.env.WECHAT_PAY_WEBHOOK_SECRET = "short";
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().paymentReadiness.issues).toContain(
      "payment callback invalid PAYMENT_CALLBACK_BASE_URL:https_required",
    );
    expect(response.json().paymentReadiness.issues).toContain(
      "payment callback invalid PAYMENT_CALLBACK_BASE_URL:public_host_required",
    );
    expect(response.json().paymentReadiness.issues).toContain(
      "wechat_pay invalid WECHAT_PAY_WEBHOOK_SECRET",
    );
  });

  it("passes deployment readiness when required payment config is present", async () => {
    configurePaymentEnv();
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().paymentReadiness).toMatchObject({
      status: "ready",
      issues: [],
    });
  });

  it("fails release readiness when diagnostics operations are not configured", async () => {
    configureAccountEnv();
    configurePaymentEnv();
    configureCallRoomEnv();
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().diagnosticsReadiness.issues).toContain(
      "diagnostics missing DIAGNOSTICS_ADMIN_TOKEN",
    );
    expect(response.json().diagnosticsReadiness.issues).toContain(
      "diagnostics missing DIAGNOSTICS_ONCALL_CONTACT",
    );
    expect(response.json().diagnosticsReadiness.issues).toContain(
      "diagnostics missing DIAGNOSTICS_ALERT_WEBHOOK_URL",
    );
    expect(response.json().diagnosticsReadiness.issues).toContain(
      "diagnostics missing DIAGNOSTICS_ALERT_WEBHOOK_SECRET",
    );
  });

  it("fails release readiness when recent fatal diagnostics exceed threshold", async () => {
    configureAccountEnv();
    configurePaymentEnv();
    configureCallRoomEnv();
    configureSmsEnv();
    configureDiagnosticsEnv();
    configureReleaseMaterialsEnv(tempDirs);
    getStoreSnapshot().appErrorReports = [
      {
        id: "evt_fatal",
        eventType: "flutter_error",
        message: "fatal",
        fatal: true,
        platform: "ios",
        occurredAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      },
    ];

    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().diagnosticsReadiness.alertState).toMatchObject({
      status: "critical",
      fatal: 1,
      fatalThreshold: 1,
    });
    expect(response.json().issues).toContain("diagnostics fatal errors 1 >= 1");
  });

  it("fails release readiness when release materials are not configured", async () => {
    configureAccountEnv();
    configurePaymentEnv();
    configureCallRoomEnv();
    configureSmsEnv();
    configureDiagnosticsEnv();
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().releaseMaterialsReadiness.issues).toContain(
      "release materials missing RELEASE_MATERIALS_FILE",
    );
  });

  it("fails release readiness when SMS provider is not configured", async () => {
    configureAccountEnv();
    configurePaymentEnv();
    configureCallRoomEnv();
    configureDiagnosticsEnv();
    configureReleaseMaterialsEnv(tempDirs);
    configureEnterpriseReleaseMaterialsEnv(tempDirs);
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().smsReadiness.issues).toContain(
      "sms missing SMS_PROVIDER",
    );
    expect(response.json().issues).toContain("sms missing SMS_PROVIDER");
  });

  it("fails release readiness when enterprise materials are not configured", async () => {
    configureAccountEnv();
    configurePaymentEnv();
    configureCallRoomEnv();
    configureSmsEnv();
    configureDiagnosticsEnv();
    configureReleaseMaterialsEnv(tempDirs);
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().enterpriseReleaseMaterialsReadiness.issues).toContain(
      "enterprise release materials missing ENTERPRISE_RELEASE_MATERIALS_FILE",
    );
  });

  it("fails release readiness when account release safety is not configured", async () => {
    configurePaymentEnv();
    configureCallRoomEnv();
    configureSmsEnv();
    configureDiagnosticsEnv();
    configureReleaseMaterialsEnv(tempDirs);
    configureEnterpriseReleaseMaterialsEnv(tempDirs);
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().accountReadiness).toMatchObject({
      status: "not_ready",
      otpSecret: "missing",
      debugCodeExposure: "enabled",
      testAutoAccount: "enabled",
    });
    expect(response.json().issues).toContain("account missing AUTH_OTP_SECRET");
    expect(response.json().issues).toContain(
      "account NODE_ENV must be production",
    );
    expect(response.json().issues).toContain(
      "account debug OTP must be disabled",
    );
    expect(response.json().issues).toContain(
      "account test auto account must be disabled",
    );
  });

  it("passes release readiness when all release gates are ready", async () => {
    configureAccountEnv();
    configurePaymentEnv();
    configureCallRoomEnv();
    configureSmsEnv();
    configureDiagnosticsEnv();
    configureReleaseMaterialsEnv(tempDirs);
    configureEnterpriseReleaseMaterialsEnv(tempDirs);
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      issues: [],
      diagnosticsReadiness: {
        status: "ready",
        adminQuery: "configured",
        onCall: "configured",
        webhook: "configured",
        alertState: { status: "ok" },
      },
      accountReadiness: { status: "ready" },
      callRoomReadiness: { status: "ready", provider: "livekit" },
      paymentReadiness: { status: "ready" },
      smsReadiness: { status: "ready", provider: "http" },
      releaseMaterialsReadiness: { status: "ready" },
      enterpriseReleaseMaterialsReadiness: { status: "ready" },
    });
  });

  it("fails release readiness when LiveKit call rooms are not configured", async () => {
    configureAccountEnv();
    configurePaymentEnv();
    configureSmsEnv();
    configureDiagnosticsEnv();
    configureReleaseMaterialsEnv(tempDirs);
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health/release-ready",
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().callRoomReadiness.issues).toContain(
      "livekit missing LIVEKIT_URL",
    );
    expect(response.json().callRoomReadiness.issues).toContain(
      "livekit missing LIVEKIT_API_KEY",
    );
    expect(response.json().callRoomReadiness.issues).toContain(
      "livekit missing LIVEKIT_API_SECRET",
    );
  });
});

function configureReleaseMaterialsEnv(tempDirs: string[]) {
  process.env.RELEASE_MATERIALS_FILE = writeManifest(tempDirs, readyManifest());
}
