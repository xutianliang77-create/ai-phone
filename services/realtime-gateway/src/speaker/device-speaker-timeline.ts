import type { DeviceSpeakerEvidenceEvent, ServerRealtimeEvent } from "@translation/contracts";
import { reconcileSpeakerRevision, type RevisableSpeakerSegment } from "./speaker-revision-reconciler.js";
import type { SpeakerRevisionSpan } from "./speaker-revision-provider.js";

/** Reuses 1.0's metadata-only speaker.updated path for delayed phone evidence.
 * Never re-runs ASR/MT, changes text, infers identity or invents word timings. */
export class DeviceSpeakerTimeline {
  private segments = new Map<string, RevisableSpeakerSegment>();
  private spans: SpeakerRevisionSpan[] = [];
  private through = 0;
  private generation = 0;
  private readonly labels = Object.fromEntries([1,2,3,4].map(i => [`device-speaker-${i}`, `device-speaker-${i}`]));
  constructor(private readonly sessionId: string, private readonly send: (event: ServerRealtimeEvent) => void) {}

  observe(event: ServerRealtimeEvent) {
    if (!("sessionId" in event) || event.sessionId !== this.sessionId) return;
    if (event.type === "session.ended") { this.segments.clear(); this.spans = []; return; }
    if (event.type !== "transcript.final") return;
    const old = this.segments.get(event.segmentId);
    if (old && (old.revision ?? 0) > (event.revision ?? 0)) return;
    if (!event.text.trim()) { this.segments.delete(event.segmentId); return; }
    this.segments.set(event.segmentId, {sessionId:this.sessionId, segmentId:event.segmentId,
      revision:event.revision, turnId:event.turnId, timing:event.timing, speaker:event.speaker,
      speakerRevision:old?.speakerRevision});
    this.reconcile();
  }
  /** Only call after the provider validated session/rate/model and accepted PCM. */
  accept(event: DeviceSpeakerEvidenceEvent) {
    const rate = event.sampleRate / 1000;
    this.through = event.throughSample/rate; this.generation = event.sequence;
    this.spans.push(...event.spans.map(s => ({speakerId:`device-speaker-${s.speaker+1}`,
      startMs:s.startSample/rate,endMs:s.endSample/rate,confidence:s.confidence,overlap:s.overlap})));
    this.spans = mergeAdjacent(this.spans.filter(s => s.endMs >= this.through-120_000));
    this.reconcile();
  }
  private reconcile() {
    for (const [id, s] of this.segments) {
      if (!s.timing || s.timing.endMs < this.through-120_000) this.segments.delete(id);
    }
    while (this.segments.size > 256) this.segments.delete(this.segments.keys().next().value!);
    const eligible = [...this.segments.values()].filter(s => s.timing!.endMs <= this.through);
    if (!eligible.length || !this.spans.length) return;
    const start = Math.min(...this.spans.map(s => s.startMs));
    const result = reconcileSpeakerRevision({sessionId:this.sessionId,generation:this.generation,
      windowStartMs:start,windowEndMs:this.through,provider:"on_device",model:"sortformer_v2_1_fastest",
      speakerCount:new Set(this.spans.map(s => s.speakerId)).size,
      spans:this.spans.map(s => ({...s,startMs:s.startMs-start,endMs:s.endMs-start}))},eligible,this.labels);
    for (const update of result.updates) {
      const segment = this.segments.get(update.segmentId)!;
      this.segments.set(update.segmentId,{...segment,speaker:update.speaker,timing:update.timing,
        speakerRevision:update.speakerRevision});
      this.send(update);
    }
  }
}

// The model produces 80ms frames. Preserve continuous overlap evidence for the
// inherited >=160ms overlap guard instead of evaluating each frame in isolation.
function mergeAdjacent(spans: SpeakerRevisionSpan[]) {
  const result: SpeakerRevisionSpan[] = [], last = new Map<string, SpeakerRevisionSpan>();
  for (const span of spans) {
    const previous = last.get(span.speakerId);
    if (previous && previous.endMs === span.startMs && previous.overlap === span.overlap) {
      const duration = previous.endMs-previous.startMs, next = span.endMs-span.startMs;
      previous.confidence = ((previous.confidence ?? 0)*duration+(span.confidence ?? 0)*next)/(duration+next);
      previous.endMs = span.endMs;
    } else { const copy={...span}; result.push(copy); last.set(span.speakerId,copy); }
  }
  return result.sort((a,b)=>a.startMs-b.startMs);
}
