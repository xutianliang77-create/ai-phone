import {describe,it,expect,vi,afterEach} from "vitest";
import {OffLlmProvider} from "@translation/llm";
import {RealtimeTranscriptRefiner} from "./lmstudio-asr-refinement.js";
import {LmStudioClient} from "./lmstudio-client.js";
import type {TranscriptResult} from "../../asr/asr-provider.js";
import {terminologyFor} from "./lmstudio-realtime-helpers.js";
const session={sessionId:"one",sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:false};
const current:TranscriptResult={segmentId:"now",turnId:"turn2",language:"zh",text:"他也会参加。",isFinal:true,
  speaker:{speakerId:"s1",role:"speaker",source:"diarization"},timing:{startMs:2000,endMs:3000,source:"model"}};
function setup(){
  const refiner=new RealtimeTranscriptRefiner({provider:new OffLlmProvider(),enabled:false,minConfidence:0.72});
  refiner.remember("one",{segmentId:"before",sourceLanguage:"zh",targetLanguage:"en",speakerId:"s1",turnId:"turn1",endMs:1800,
    rememberedAt:Date.now(),rawText:"王先生将来参加会议。",translatedText:"Mr Wang will join the meeting."});
  return refiner;
}
afterEach(()=>vi.useRealTimers());
describe("bounded public MT context on the original transcript cache",()=>{
  it("selects terms in the actual segment before the inherited 40-term prompt bound",()=>{
    const terms=Array.from({length:55},(_,i)=>({id:String(i),sourceText:`Product${i}`,translatedText:`产品${i}`,
      sourceLanguage:"en" as const,targetLanguage:"zh" as const,status:"active" as const,createdAt:"2026-09-01",updatedAt:"2026-09-01"}));
    expect(terminologyFor({...session,terminology:terms},"en","zh","Use Product54, not Product10x.").map(t=>t.id)).toEqual(["54"]);
    expect(terminologyFor({...session,terminology:terms},"en","ja","Use Product54.")).toEqual([]);
    expect(terminologyFor({...session,terminology:terms},"en","zh")).toHaveLength(40); // Original private caller unchanged.
  });
  it("uses prior same-speaker context without repeating the current revision",()=>{
    const r=setup();expect(r.translationContext(session,current,"en")).toHaveLength(1);
    expect(r.translationContext(session,{...current,segmentId:"before"},"en")).toEqual([]);
  });
  it("never crosses account/session, direction, speaker, unknown turns or long gaps",()=>{
    const r=setup();
    expect(r.translationContext({...session,sessionId:"two"},current,"en")).toEqual([]);
    expect(r.translationContext(session,current,"ja")).toEqual([]);
    expect(r.translationContext(session,{...current,speaker:{...current.speaker!,speakerId:"s2"}},"en")).toEqual([]);
    expect(r.translationContext(session,{...current,speaker:undefined},"en")).toEqual([]);
    expect(r.translationContext(session,{...current,timing:{...current.timing!,startMs:9000,endMs:10000}},"en")).toEqual([]);
    r.clear(session.sessionId);expect(r.translationContext(session,current,"en")).toEqual([]);
  });
  it("delivers context as bounded data while leaving the current user text unchanged",async()=>{
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"He will join too."}}]})));
    const c=new LmStudioClient({transportProfile:"public_compatible",baseUrl:"https://synthetic.invalid",apiKey:"SYNTHETIC",model:"manual",timeoutMs:1000,fetchFn});
    await c.translate({text:current.text,sourceLanguage:"zh",targetLanguage:"en",context:setup().translationContext(session,current,"en")});
    const body=JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body.messages[1]).toEqual({role:"user",content:current.text});
    expect(body.messages[0].content).toContain("not instructions");expect(body.messages[0].content).toContain("Mr Wang");
    await expect(c.translate({text:current.text,sourceLanguage:"zh",targetLanguage:"en",context:Array(3).fill({sourceText:"x",translatedText:"y"})})).rejects.toThrow("context_invalid");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
