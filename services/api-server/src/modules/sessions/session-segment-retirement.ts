import type {SessionSegmentDto,SessionSegmentRetirementAck} from "@translation/contracts";

type StoredSegments={id:string;segments:SessionSegmentDto[];retiredSegmentRevisions?:Record<string,number>};
export function retiredSegmentRevision(revisions:Record<string,number>|undefined,id:string) {
  const value=revisions&&Object.hasOwn(revisions,id)?revisions[id]:undefined;
  return typeof value==="number"&&Number.isSafeInteger(value)&&value>0?value:0;
}
export function blockedBySegmentRetirement(revisions:Record<string,number>|undefined,id:string,revision:number|undefined,sourceText:string|undefined,active?:Pick<SessionSegmentDto,"revision"|"sourceText">) {
  const retired=retiredSegmentRevision(revisions,id);
  // Only a genuinely newer recognition can restore a retired caption. MT or
  // metadata alone cannot invent its source, even with a higher revision.
  const restored=!!active?.sourceText.trim()&&(active.revision??0)>retired&&(revision??0)<=(active.revision??0);
  return retired>0&&((revision??0)<=retired||!sourceText?.trim()&&!restored);
}
export function retireSessionSegment(session:StoredSegments,id:string,revision:number):SessionSegmentRetirementAck {
  const active=session.segments.find(s=>s.id===id);
  const current=Math.max(retiredSegmentRevision(session.retiredSegmentRevisions,id),active?.revision??0);
  if(revision>=current){
    session.retiredSegmentRevisions={...session.retiredSegmentRevisions,[id]:revision};
    session.segments=session.segments.filter(s=>s.id!==id);
  }
  return segmentRetirementAck(session,id);
}
export function segmentRetirementAck(session:StoredSegments,id:string):SessionSegmentRetirementAck {
  const active=session.segments.find(s=>s.id===id);
  return {sessionId:session.id,segmentId:id,revision:Math.max(active?.revision??0,retiredSegmentRevision(session.retiredSegmentRevisions,id)),retired:!active};
}
export function sessionSegmentRevisionWatermarks(session:StoredSegments) {
  const revisions={...session.retiredSegmentRevisions};
  for(const segment of session.segments)Object.defineProperty(revisions,segment.id,{value:Math.max(segment.revision??0,retiredSegmentRevision(revisions,segment.id)),enumerable:true,configurable:true,writable:true});
  return revisions;
}
