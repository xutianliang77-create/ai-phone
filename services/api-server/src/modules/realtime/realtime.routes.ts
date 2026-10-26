import {selfHostedAdmission,selfHostedOwnerAllowed} from "@translation/platform-security";
import {usesSharedControl} from '../account/shared-control-client.js';
import {createSharedControlSession,cancelSharedControlSession,checkSharedControlServing,completeSharedControlSession} from './shared-control-session.js';
import {createIdempotentSession,CreationConflict} from "./idempotent-session-create.js";
import type { FastifyInstance } from "fastify";
import {
  type UpdateRealtimeSessionStateRequest,
  type UpsertSessionSegmentRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { authorizationSessionHash, authSessionHashIsActive } from "../account/auth-session-binding.js";
import {
  findSession,
  saveSegments,
  transitionSessionState,
  upsertSegment,
} from "../sessions/sessions-runtime.repository.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { validateCreateRealtimeSessionRequest } from "./create-session-request.js";
import { createRealtimeSession } from "./realtime.service.js";
import { parseRealtimeDiagnostics } from "./realtime-diagnostics.js";
import { registerRealtimeFinalizationRoute } from "./realtime-finalization.routes.js";
import {
  isInternalAuthorized,
  isInternalRealtimeState,
  parseBillableSeconds,
} from "./realtime-route-validation.js";
import { isValidSegmentPatch } from "./realtime-segment-validation.js";
import { formalRealtimeRelease, verifiedGatewaySettlement } from "./gateway-settlement.js";

export async function registerRealtimeRoutes(app: FastifyInstance) {
  registerRealtimeFinalizationRoute(app);
  app.post("/realtime/sessions", async (request, reply) => {
    if(!selfHostedAdmission().open)return sendError(reply,503,"service_admission_closed","Service admission is closed");
    if(usesSharedControl()){
      const input=request.body as Record<string,unknown>;
      const parsed=validateCreateRealtimeSessionRequest(input);
      if(!parsed.ok)return sendError(reply,400,parsed.error.code,parsed.error.message);
      return createSharedControlSession(undefined,request.headers.authorization??'',input.controlEnvelope,parsed.value);
    }
    const account = await requireAccount(request, reply);
    if (!account) return;
    if(!selfHostedOwnerAllowed(account.id))return sendError(reply,403,"account_not_in_test_scope","Account is not in the current test scope");
    const parsed = validateCreateRealtimeSessionRequest(request.body);
    if (!parsed.ok) {
      return sendError(reply, 400, parsed.error.code, parsed.error.message);
    }
    if (formalRealtimeRelease() && !authorizationSessionHash(request.headers.authorization)) {
      return sendError(reply, 401, "auth_required", "A signed-in account is required");
    }
    if (formalRealtimeRelease() &&
        (!["auto", "zh", "en"].includes(parsed.value.sourceLanguage) ||
         !["zh", "en"].includes(parsed.value.targetLanguage) ||
         (parsed.value.voice && parsed.value.voice.mode !== "preset"))) {
      return sendError(reply, 400, "feature_not_in_release", "This release supports Chinese/English and preset voices");
    }

    let result;
    try{result = process.env.AUTH_PROVIDER==='apple'
      ? await createIdempotentSession(account.id,parsed.value,authorizationSessionHash(request.headers.authorization)!,request.headers['idempotency-key'])
      : await createRealtimeSession(account.id, parsed.value,
      formalRealtimeRelease() ? { ownerAuthSessionHash: authorizationSessionHash(request.headers.authorization) } : {});
    }catch(error){if(error instanceof CreationConflict)return sendError(reply,409,error.code,"Creation request remains bound to its original session");throw error;}
    if (!result) {
      return sendError(
        reply,
        402,
        "quota_not_enough",
        "Not enough free minutes",
      );
    }
    return result;
  });

  app.get("/realtime/sessions/:sessionId/status", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const session = await findSession(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (session.userId !== account.id) return forbidden(reply);
    return {
      sessionId: session.id,
      status: session.status,
      consumedSeconds: session.consumedSeconds,
    };
  });

  app.post("/realtime/sessions/:sessionId/end", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    return withSessionWriteLock(params.sessionId, async () => {
      const existing = await findSession(params.sessionId);
      if (!existing)
        return sendError(reply, 404, "session_not_found", "Session not found");
      if (existing.userId !== account.id) return forbidden(reply);
      if(existing.billingAuthority==='cloudflare_v10'){
        if(existing.status==='ended')return {sessionId:existing.id,status:'ended'};
        return cancelSharedControlSession(existing,request.headers.authorization??'');
      }
      if(formalRealtimeRelease()&&existing.status==='created'&&existing.creationRequestHash&&existing.ownerAuthSessionHash){
        const cancelled=await completeSessionWithUsage(existing.id,{billableSeconds:0});
        return {sessionId:existing.id,status:cancelled?.status??existing.status};
      }
      if (formalRealtimeRelease() && existing.status !== "ended") {
        return sendError(reply, 409, "gateway_settlement_pending", "Gateway stop evidence is required; usage remains pending");
      }
      const session = await completeSessionWithUsage(params.sessionId);
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      return { sessionId: session.id, status: session.status };
    });
  });

  app.post("/internal/realtime/segments", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(
        reply,
        401,
        "internal_error",
        "Unauthorized internal request",
      );
    }

    const body = request.body as Partial<UpsertSessionSegmentRequest>;
    if (!isValidSegmentPatch(body)) {
      return sendError(reply, 400, "invalid_segments", "Invalid segment patch");
    }

    return withSessionWriteLock(body.sessionId, async () => {
      const session = await upsertSegment(body.sessionId, {
      segmentId: body.segmentId,
      speechId: body.speechId,
      turnId: body.turnId,
      revision: body.revision,
      speakerRevision: body.speakerRevision,
      pipelineGeneration: body.pipelineGeneration,
      pipelineTiming: body.pipelineTiming,
      sourceText: body.sourceText,
      rawText: body.rawText,
      optimizedText: body.optimizedText,
      translatedText: body.translatedText,
      dominantLanguage: body.dominantLanguage,
      detectedLanguages: body.detectedLanguages,
      mixedLanguage: body.mixedLanguage,
      sourceLanguage: body.sourceLanguage,
      targetLanguage: body.targetLanguage,
      confidence: body.confidence,
      stage: body.stage,
      provider: body.provider,
      model: body.model,
      latencyMs: body.latencyMs,
      providerUsage: body.providerUsage,
      refinement: body.refinement,
      speaker: body.speaker,
      timing: body.timing,
      tokenTimings: body.tokenTimings,
      vadContext: body.vadContext,
      });
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      return { sessionId: session.id, segmentCount: session.segments.length };
    });
  });

  app.post(
    "/internal/realtime/sessions/:sessionId/state",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }
      const params = request.params as { sessionId: string };
      const body = request.body as Partial<UpdateRealtimeSessionStateRequest> & { fresh?: boolean; connectionNonce?:string; previousNonce?:string; previousProviderClosed?:boolean };
      if (!isInternalRealtimeState(body.status)) {
        return sendError(
          reply,
          400,
          "invalid_session_state",
          "Invalid realtime session state",
        );
      }
      if(!selfHostedAdmission().open)return sendError(reply,503,"service_admission_closed","Service admission is closed");
      const requestedStatus = body.status;
      return withSessionWriteLock(params.sessionId, async () => {
        const current = await findSession(params.sessionId);
        if(current?.billingAuthority==='cloudflare_v10'){
          if(typeof body.connectionNonce!=='string'||!/^[a-f0-9]{64}$/.test(body.connectionNonce))return sendError(reply,409,'control_connection_proof_required','Device connection proof is required');
          await checkSharedControlServing(current,body.connectionNonce,body.fresh===true,body.previousNonce,body.previousProviderClosed===true);
        } else if (formalRealtimeRelease()) {
          if (!current?.ownerAuthSessionHash ||
              !await authSessionHashIsActive(current.ownerAuthSessionHash, current.userId)) {
            if(current?.status==='created'&&current.creationRequestHash&&current.ownerAuthSessionHash){
              await completeSessionWithUsage(current.id,{billableSeconds:0});
              return reply.status(403).send({error:{code:'session_never_admitted_closed',message:'Session was safely cancelled before admission',sessionId:current.id,ownerId:current.userId}});
            }
            return sendError(reply, 403, "session_authorization_revoked", "Session authorization is unavailable");
          }
          if (body.fresh === true && current.status !== "created") {
            return sendError(reply, 409, "session_admission_conflict", "Session has already been admitted");
          }
        }
        const result = await transitionSessionState(params.sessionId, requestedStatus);
        if (!result) {
          return sendError(reply, 404, "session_not_found", "Session not found");
        }
        if (!result.transition.accepted) {
          return sendError(
            reply,
            409,
            "session_state_conflict",
            `Cannot change session from ${result.transition.previous} to ${requestedStatus}`,
          );
        }
        return {
          sessionId: result.session.id,
          status: result.session.status,
          changed: result.transition.changed,
        };
      });
    },
  );

  app.post(
    "/internal/realtime/sessions/:sessionId/end",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }

      const params = request.params as { sessionId: string };
      const body = request.body as Partial<{
        billableSeconds: unknown;
        diagnostics: unknown;
        gatewayReceipt: unknown;
      }> | undefined;
      const billableSeconds = parseBillableSeconds(body?.billableSeconds);
      const diagnostics = parseRealtimeDiagnostics(body?.diagnostics);
      if (body?.diagnostics !== undefined && !diagnostics) {
        return sendError(
          reply,
          400,
          "invalid_session_diagnostics",
          "Invalid realtime session diagnostics",
        );
      }
      return withSessionWriteLock(params.sessionId, async () => {
        const existing = await findSession(params.sessionId);
        if (!existing) return sendError(reply, 404, "session_not_found", "Session not found");
        if(existing.billingAuthority==='cloudflare_v10')return completeSharedControlSession(existing,body?.gatewayReceipt);
        const gateway = formalRealtimeRelease() ? verifiedGatewaySettlement(existing, body?.gatewayReceipt) : null;
        if (formalRealtimeRelease() && !gateway) {
          return sendError(reply, 409, "gateway_settlement_pending", "Valid gateway stop evidence is required");
        }
        const session = await completeSessionWithUsage(params.sessionId, {
          ...(gateway ? { billableSeconds: gateway.billableSeconds } :
            typeof billableSeconds === "number" ? { billableSeconds } : {}),
          ...(gateway ? { gatewayReceipt: gateway.receipt } : {}),
          ...(diagnostics ? { diagnostics } : {}),
        });
        if (!session)
          return sendError(reply, 404, "session_not_found", "Session not found");
        return { sessionId: session.id, status: session.status };
      });
    },
  );
}

function forbidden(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    403,
    "account_forbidden",
    "Account cannot access this resource",
  );
}
