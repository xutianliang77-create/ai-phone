import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { requireAccount } from "../account/account-auth.js";
import {
  findSessionProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { findCallLink } from "./call-links.service.js";

export function registerCallLinkPhoneStatusRoutes(app: FastifyInstance) {
  app.get("/call-links/:callId/phone-status", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const callId = (request.params as { callId: string }).callId;
    const record = await findCallLink(callId);
    if (!record) {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    if (record.userId !== account.id) {
      return sendError(reply, 403, "account_forbidden",
        "Account cannot access this resource");
    }
    const [phone, sip] = await Promise.all([
      findSessionProviderOperation(record.sessionId, "phone_outbound"),
      findSessionProviderOperation(record.sessionId, "sip_outbound"),
    ]);
    if (!phone && !sip) {
      return sendError(reply, 404, "phone_outbound_missing",
        "Outbound phone call is missing");
    }
    if (phone && sip) {
      return sendError(reply, 409, "phone_outbound_binding_conflict",
        "Outbound phone call binding conflicts");
    }
    const operation = phone ?? sip!;
    const carrier = operation.provider === "air780_volte"
      ? await findAirCarrierStatus(record.sessionId, operation.id)
      : null;
    const providerCallId = operation.provider === "livekit_sip"
      ? operation.externalOperationId ?? operation.externalResourceId
      : operation.externalResourceId ?? operation.externalOperationId;
    return reply.header("cache-control", "no-store").send({
      callId: record.callId,
      sessionId: record.sessionId,
      operationId: operation.id,
      provider: operation.provider,
      providerOperationStatus: operation.status,
      ...(providerCallId
        ? { providerCallId }
        : {}),
      ...(carrier ?? {}),
    });
  });
}

async function findAirCarrierStatus(
  communicationSessionId: string,
  providerOperationId: string,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return null;
  const call = await runtime.postgres.airDeviceCalls.findCallStatus({
    communicationSessionId,
    providerOperationId,
  });
  return call ? {
    carrierState: call.carrierState,
    callGeneration: call.callGeneration,
  } : null;
}
