import type { FastifyInstance, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  listAccountConsents,
  recordAccountConsent,
} from "./account-consent-runtime.service.js";
import {
  accountFromAuthorization,
  loginWithPhoneCode,
  logout,
  requestAccountDeletion,
  requestPhoneLoginCode,
  toAccountDto,
} from "./account-runtime.service.js";
import { exportAccountData } from "./account-export-runtime.service.js";

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get("/auth/deployment",async(_request,reply)=>{
    const deploymentId=process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
    if(!deploymentId) return sendError(reply,503,"public_deployment_not_ready","Public deployment identity is not configured");
    return {deploymentId};
  });
  app.post("/auth/phone/request-code", async (request, reply) => {
    if (!matchesDeployment(request.body, reply)) return;
    const body = request.body as Partial<{ phone: unknown }> | undefined;
    if (typeof body?.phone !== "string") {
      return sendError(reply, 400, "invalid_phone", "Invalid phone number");
    }
    const result = await requestPhoneLoginCode(body.phone, {
      clientKey: clientKeyFromRequest(request),
    });
    if (!result.ok) {
      const status = phoneCodeRequestStatus(result.code);
      const retryAfter = retryAfterSeconds(result);
      if (retryAfter) reply.header("retry-after", retryAfter.toString());
      return sendError(reply, status, result.code, "Phone code request failed");
    }
    return loginResponse(result);
  });

  app.post("/auth/phone/login", async (request, reply) => {
    if (!matchesDeployment(request.body, reply)) return;
    const body = request.body as
      Partial<{ phone: unknown; code: unknown }> | undefined;
    if (typeof body?.phone !== "string" || typeof body?.code !== "string") {
      return sendError(reply, 400, "invalid_login", "Invalid login request");
    }
    const result = await loginWithPhoneCode(body.phone, body.code, {
      clientKey: clientKeyFromRequest(request),
    });
    if (!result.ok) {
      const status = phoneLoginStatus(result.code);
      return sendError(reply, status, result.code, "Phone login failed");
    }
    return loginResponse(result);
  });

  app.post("/auth/logout", async (request) => {
    await logout(request.headers.authorization);
    return { status: "ok" };
  });

  app.get("/account/me", async (request, reply) => {
    const account = await requireAccount(request);
    if (!account) return unauthorized(reply);
    return { account: toAccountDto(account) };
  });

  app.get("/account/export", async (request, reply) => {
    const account = await requireAccount(request);
    if (!account) return unauthorized(reply);
    return await exportAccountData(account);
  });

  app.get("/account/consents", async (request, reply) => {
    const account = await requireAccount(request);
    if (!account) return unauthorized(reply);
    return { consents: await listAccountConsents(account) };
  });

  app.post("/account/consents", async (request, reply) => {
    const account = await requireAccount(request);
    if (!account) return unauthorized(reply);
    const body = request.body as Record<string, unknown> | undefined;
    const result = await recordAccountConsent(account, body ?? {});
    if (!result.ok) {
      return sendError(reply, 400, result.code, "Invalid consent record");
    }
    return result.consent;
  });

  app.post("/account/delete", async (request, reply) => {
    const account = await requireAccount(request);
    if (!account) return unauthorized(reply);
    return { account: await requestAccountDeletion(account) };
  });
}

function matchesDeployment(body: unknown, reply: Parameters<typeof sendError>[0]) {
  const expected = process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
  const requested = body && typeof body === "object" ? (body as Record<string,unknown>).deploymentId : undefined;
  if ((expected || requested !== undefined) && (!expected || requested !== expected)) {
    sendError(reply,503,"deployment_identity_mismatch","Login deployment identity does not match");
    return false;
  }
  return true;
}
function loginResponse<T extends object>(result:T) {
  const deploymentId = process.env.API_RESULT_SYNC_DEPLOYMENT_ID;
  return deploymentId ? {...result,deploymentId} : result;
}

async function requireAccount(request: FastifyRequest) {
  return accountFromAuthorization(request.headers.authorization);
}

function phoneCodeRequestStatus(code: string) {
  if (code === "invalid_phone") return 400;
  if (
    code === "sms_code_resend_too_soon" ||
    code === "sms_code_daily_limit_exceeded"
  ) {
    return 429;
  }
  return 503;
}

function phoneLoginStatus(code: string) {
  if (code === "invalid_phone") return 400;
  if (code === "too_many_login_attempts") return 429;
  if (code === "account_unavailable") return 403;
  return 401;
}

function retryAfterSeconds(result: unknown) {
  if (!result || typeof result !== "object") return null;
  if (!("retryAfterSeconds" in result)) return null;
  const value = result.retryAfterSeconds;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clientKeyFromRequest(request: FastifyRequest) {
  const deviceHeader = request.headers["x-device-id"];
  const deviceId = Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader;
  if (typeof deviceId === "string" && deviceId.trim()) {
    return `device:${deviceId.trim().slice(0, 128)}`;
  }
  return `ip:${request.ip}`;
}

function unauthorized(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 401, "auth_required", "Account login required");
}
