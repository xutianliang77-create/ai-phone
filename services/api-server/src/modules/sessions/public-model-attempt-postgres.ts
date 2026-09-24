import {createHash,randomUUID} from "node:crypto";
import type {PublicModelAttemptAck,PublicModelAttemptEvent} from "@translation/contracts";
import {PostgresPrimaryStore} from "../../infrastructure/storage/postgres-primary-store.js";
import {withPostgresRepositoryFence} from "../../infrastructure/storage/postgres-repository-fence.js";
import {getRepositoryRuntime} from "../../infrastructure/storage/repository-runtime.js";
import {enqueueSessionChanged,requireSession,requireSessionUpdate,sessionEventId} from "./postgres-session-uow.js";
import {ResultSyncError} from "./session-result-sync-contract.js";
import type {SessionRecord} from "./session-record.js";
import type {PublicModelAttemptRecord} from "./public-model-attempt.service.js";
import {updatedPublicAttemptSummary} from "./public-model-attempt-summary.js";

type StoredAttempt=PublicModelAttemptRecord & {version:number};
type Plan=(current:SessionRecord,related:PublicModelAttemptRecord[])=>{next:SessionRecord|null;result:PublicModelAttemptAck};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const key=(sessionId:string,attemptId:string)=>`${hash(sessionId)}:${hash(attemptId)}`;

/** One existing session fence and one primary transaction cover both the
 * attempt record and the session's bounded unresolved/summary projection. */
export async function recordPostgresPublicAttempt(
  sessionId:string,event:PublicModelAttemptEvent,plan:Plan,
):Promise<PublicModelAttemptAck>{
  const runtime=getRepositoryRuntime();
  if(runtime.driver!=="postgres")throw Error("PostgreSQL attempt storage is not active");
  return withPostgresRepositoryFence({aggregateType:"communication_session",aggregateId:sessionId},async fence=>{
    const primary=new PostgresPrimaryStore(runtime.postgres.pool);
    return primary.withAggregateTransaction(fence,async transaction=>{
      const currentRecord=await transaction.read<SessionRecord>("sessions",sessionId);
      if(!currentRecord)throw new ResultSyncError("session_not_found",404);
      const current=requireSession(currentRecord.payload,sessionId);
      if(current.publicAttemptStorageVersion!==2)throw new ResultSyncError("model_attempt_storage_mismatch",503);
      const attemptKey=key(sessionId,event.attemptId);
      const oldRecord=await transaction.read<StoredAttempt>("publicModelAttempts",attemptKey);
      const rows=await transaction.queryRead<{payload:PublicModelAttemptRecord}>(`
        SELECT payload FROM ai_phone.public_model_attempts
        WHERE session_id=$1 AND (attempt_id=$2
          OR (component IN ('tts','translation') AND segment_id=$3 AND revision=$4)
          OR ($5='asr' AND component='asr' AND state<>'not_sent'
            AND audio_start_sample<$7 AND audio_end_sample>$6))
        ORDER BY created_at DESC LIMIT 1024
      `,[sessionId,event.attemptId,event.segmentId,event.revision,event.component,
        event.audioStartSample??null,event.audioEndSample??null]);
      const related=rows.map(row=>row.payload);
      if(oldRecord&&!related.some(item=>item.event.attemptId===event.attemptId)){
        related.push(oldRecord.payload);
      }
      const mutation=plan(current,related);
      if(!mutation.next)return mutation.result;
      const changed=mutation.next.publicModelAttempts?.find(item=>item.event.attemptId===event.attemptId);
      if(!changed)throw new ResultSyncError("model_attempt_projection_missing",503);
      const stored:StoredAttempt={...changed,version:(oldRecord?.payload.version??0)+1};
      mutation.next.version=(current.version??1)+1;
      const next=requireSessionUpdate(current,mutation.next);
      next.publicModelAttempts=next.publicModelAttempts?.filter(item=>
        item.event.state==="dispatching"||item.event.state==="uncertain");
      next.publicAttemptSummary=updatedPublicAttemptSummary(current.publicAttemptSummary,oldRecord?.payload,stored);
      if((next.publicModelAttempts?.length??0)>1024)throw new ResultSyncError("model_attempt_unresolved_capacity",409);
      const attemptEventId=randomUUID();
      await transaction.mutate<StoredAttempt>({eventId:attemptEventId,namespace:"publicModelAttempts",
        recordKey:attemptKey,operation:"upsert",payload:stored,
        expectedRecordVersion:oldRecord?.recordVersion??null});
      const sessionEvent=sessionEventId(attemptEventId,"attempt-session");
      const saved=await transaction.mutate<SessionRecord>({eventId:sessionEvent,namespace:"sessions",
        recordKey:sessionId,operation:"upsert",payload:next,
        expectedRecordVersion:currentRecord.recordVersion});
      const session=requireSession(saved?.payload,sessionId);
      await enqueueSessionChanged(transaction,{eventId:sessionEvent,sessionId,version:session.version,
        eventType:"communication_session.updated",session});
      return mutation.result;
    });
  });
}
