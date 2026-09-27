import type {SessionRecord} from "./session-record.js";
import {applySessionSegmentPatch,createSessionSegment,type SessionSegmentPatch} from "./session-segment-merge.js";
import {blockedBySegmentRetirement,retireSessionSegment} from "./session-segment-retirement.js";
import {orderSessionSegmentsChronologically} from "./session-segment-order.js";

/** Shared by the original memory/JSON and PostgreSQL fenced mutation paths. */
export function applyStoredSessionSegmentPatch(session:SessionRecord,patch:SessionSegmentPatch) {
  if(patch.retired){
    if(session.processingAuthorization?.processingMode!=="online"||!Number.isSafeInteger(patch.revision)||(patch.revision??0)<1)throw Error("public_segment_retirement_required");
    retireSessionSegment(session,patch.segmentId,patch.revision!);return;
  }
  if(blockedBySegmentRetirement(session.retiredSegmentRevisions,patch.segmentId,patch.revision,patch.sourceText))return;
  const existing=session.segments.find(s=>s.id===patch.segmentId);
  if(existing)applySessionSegmentPatch(existing,patch,{versionedSpeakerMetadata:session.processingAuthorization?.processingMode==="online"});else session.segments.push(createSessionSegment(patch));
  session.segments=orderSessionSegmentsChronologically(session.segments);
}
