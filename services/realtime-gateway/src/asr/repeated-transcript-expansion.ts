import {canonicalSegmentText} from '@translation/speech-quality';

export const repeatedAsrExpansionMessage =
  '本段识别结果出现异常重复，未发送翻译或朗读；会话继续。';

export interface RepeatedAsrExpansion {
  reason: 'repeated_expansion';
  durationMs: number;
  normalizedCharacters: number;
  repeatedCharacters: number;
}

/** Conservative, provider/language-neutral quarantine, NOT text correction.
 * Require BOTH extreme text/time expansion and substantial non-overlapping
 * repeated spans in this ONE result. Never deduplicate distinct spoken turns.
 * Missing timing, short answers, long-duration speech and unique identifiers
 * cannot be rejected by repetition alone. The existing cleaner stays authoritative.
 * These are application safety bounds, not a calibrated ASR confidence score. */
export function repeatedAsrExpansion(input: {
  text: string;
  timing?: {startMs: number; endMs: number};
}): RepeatedAsrExpansion | undefined {
  const timing=input.timing;
  if(!timing||!Number.isFinite(timing.startMs)||!Number.isFinite(timing.endMs)||
    timing.startMs<0||timing.endMs<=timing.startMs)return;
  const durationMs=timing.endMs-timing.startMs;
  // Bound work/memory even for an oversized supplier response. Compare this
  // prefix to the FULL audio range; never invent a shorter speech duration.
  const text=canonicalSegmentText(input.text.slice(0,16_384).normalize('NFKC'))
    .replace(/[^\p{L}\p{N}]/gu,'');
  const symbols=Array.from(text).slice(0,16_384),length=symbols.length;
  if(length<128||length*1000<=durationMs*40)return;
  const span=24,first=new Map<string,number>(),repeated=new Uint8Array(length);
  for(let at=0;at<=length-span;at++){
    const key=symbols.slice(at,at+span).join(''),previous=first.get(key);
    if(previous===undefined)first.set(key,at);
    // Overlapping windows in one word/phrase do not constitute a replay.
    else if(at-previous>=span)repeated.fill(1,at,at+span);
  }
  const repeatedCharacters=repeated.reduce((count,value)=>count+value,0);
  if(repeatedCharacters<64||repeatedCharacters/length<0.25)return;
  return {reason:'repeated_expansion',durationMs,normalizedCharacters:length,repeatedCharacters};
}
