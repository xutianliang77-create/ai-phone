import type { ServerRealtimeEvent } from "@translation/contracts";
import type { TranscriptResult } from "../../asr/asr-provider.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";
import type {SegmentAssembler,SegmentPushResult} from "../../segments/segment-assembler.js";

/** Decide against the evidence receipt clock. Delivery/MT stays on the
 * existing serial Provider path, even if that path is temporarily busy. */
export class PendingSpeakerAssemblies {
  private readonly pending=new WeakMap<RealtimeProviderSession,SegmentPushResult[]>();
  canAccept(session:RealtimeProviderSession){return (this.pending.get(session)?.length??0)<32;}
  capture(session:RealtimeProviderSession,assembler:SegmentAssembler,
    project:((parts:TranscriptResult[])=>TranscriptResult[])|undefined,now:number){
    if(!project)return;
    const result=assembler.refreshSpeakers(session.sessionId,project,now);
    if(result.ready.length||result.supersededSegmentIds?.length){
      const queued=this.pending.get(session)??[];queued.push(structuredClone(result));this.pending.set(session,queued);
    }
  }
  drain(session:RealtimeProviderSession,assembler:SegmentAssembler,project:(parts:TranscriptResult[])=>TranscriptResult[]){
    const queued=this.pending.get(session)??[];this.pending.delete(session);
    return [...queued,assembler.refreshSpeakers(session.sessionId,project)];
  }
}

export function continuationTombstones(
  session: RealtimeProviderSession,
  transcript: TranscriptResult,
  segmentIds: string[] | undefined,
): ServerRealtimeEvent[] {
  return (segmentIds ?? []).map((segmentId) => ({
    type: "transcript.final",
    sessionId: session.sessionId,
    segmentId,
    turnId: transcript.turnId,
    revision: transcript.revision,
    text: "",
    language: transcript.language,
  }));
}
