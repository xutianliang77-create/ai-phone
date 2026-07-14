import type { FastifyInstance } from "fastify";
import { requireAccount } from "../account/account-auth.js";
import { isInternalAuthorized } from "../agent-calls/agent-call-route-helpers.js";
import {
  createVoiceIdentity,
  deleteIdentity,
  enrollIdentity,
  listVoiceIdentities,
  matchAuthorizedIdentity,
  revokeIdentity,
} from "./voice-identities.service.js";

export async function registerVoiceIdentityRoutes(app: FastifyInstance) {
  app.get("/voice-identities", async (request, reply) => {
    const account = requireAccount(request, reply); if (!account) return;
    return { identities: listVoiceIdentities(account.id) };
  });
  app.post("/voice-identities", async (request, reply) => {
    const account = requireAccount(request, reply); if (!account) return;
    const identity = createVoiceIdentity(account.id, body(request.body));
    return identity
      ? reply.status(201).send({ identity })
      : reply.status(400).send({ error: { code: "voice_identity_consent_required" } });
  });
  app.post("/voice-identities/:identityId/reference-audio", async (request, reply) => {
    const account = requireAccount(request, reply); if (!account) return;
    const result = await enrollIdentity(account.id, params(request).identityId, body(request.body));
    return result.ok ? result : reply.status(result.statusCode).send({
      error: { code: result.code, message: result.message },
      ...("quality" in result ? { quality: result.quality } : {}),
    });
  });
  app.post("/voice-identities/:identityId/revoke", async (request, reply) => {
    const account = requireAccount(request, reply); if (!account) return;
    const result = await revokeIdentity(account.id, params(request).identityId);
    return result.ok ? result : reply.status(result.statusCode).send({ error: { code: result.code } });
  });
  app.delete("/voice-identities/:identityId", async (request, reply) => {
    const account = requireAccount(request, reply); if (!account) return;
    const result = await deleteIdentity(account.id, params(request).identityId);
    return result.ok ? result : reply.status(result.statusCode).send({ error: { code: result.code } });
  });
  app.post("/internal/voice-identities/match", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return reply.status(401).send({ error: { code: "internal_error" } });
    }
    const requestBody = body(request.body);
    const userId = typeof requestBody.userId === "string" ? requestBody.userId : "";
    const audioBase64 = typeof requestBody.audioBase64 === "string" ? requestBody.audioBase64 : "";
    if (!userId || !audioBase64) return reply.status(400).send({ error: { code: "invalid_request" } });
    try { return await matchAuthorizedIdentity(userId, audioBase64); }
    catch { return reply.status(503).send({ error: { code: "voice_identity_provider_unavailable" } }); }
  });
}

function body(value: unknown) { return (value ?? {}) as Record<string, unknown>; }
function params(request: { params: unknown }) { return request.params as { identityId: string }; }
