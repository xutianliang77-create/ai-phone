import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAccount } from "../account/account-auth.js";
import { sendError } from "../../infrastructure/http/errors.js";
import { withSessionWriteLock } from "./session-write-coordinator.js";
import { ResultSyncError } from "./session-result-sync-contract.js";
import { setResultSyncConsent, syncSessionResults,readResultSyncConsent } from "./session-result-sync.service.js";

export function registerResultSyncConsentRoute(app: FastifyInstance) {
  app.get("/sessions/:sessionId/result-sync-consent",async(request,reply)=>{
    const account=await requireAccount(request,reply);if(!account)return;
    const {sessionId}=request.params as {sessionId:string};
    return resultSyncResponse(reply,()=>readResultSyncConsent(sessionId,account.id));
  });
  app.post("/sessions/:sessionId/result-sync-consent", { bodyLimit: 4096 }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const { sessionId } = request.params as { sessionId: string };
    return resultSyncResponse(reply, () => withSessionWriteLock(sessionId,
      () => setResultSyncConsent(sessionId, account.id, request.body)));
  });
}
export function handleResultSync(reply: FastifyReply, sessionId: string, ownerId: string, body: unknown) {
  return resultSyncResponse(reply, () => withSessionWriteLock(sessionId,
    () => syncSessionResults(sessionId, ownerId, body)));
}
async function resultSyncResponse(reply: FastifyReply, action: () => Promise<unknown>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof ResultSyncError) return sendError(reply, error.status, error.code, error.message);
    throw error;
  }
}
