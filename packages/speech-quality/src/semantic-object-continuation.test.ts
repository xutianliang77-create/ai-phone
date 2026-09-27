import {describe,expect,it} from "vitest";
import {SegmentAssembler} from "./segment-assembler.js";
import {analyzeTurnLanguage} from "./turn-language-profile.js";
import type {SpeechTranscript} from "./speech-transcript.js";

function part(id:string,text:string,language:"zh"|"en"="zh",change:Partial<SpeechTranscript>={}):SpeechTranscript {
  return {segmentId:id,text,language,revision:1,turnId:"turn",automaticLanguageStatus:"detected",
    speaker:{speakerId:"same",role:"speaker",source:"diarization"},
    timing:{startMs:id==="first"?48632:51200,endMs:id==="first"?51200:55328,source:"estimated"},
    ...analyzeTurnLanguage(text,language),...change};
}
const create=()=>new SegmentAssembler({emitSemanticContinuationRevisions:true,maxBufferMs:3000});
const first=()=>part("first","我们要测试 Qwen Three ASR。");
const second=()=>part("second","Hy-MT2 和 VoxCPM2 的在线模型链路。");

describe("object and enumeration continuation through the existing revision path",()=>{
  it.each([
    ["我们要测试 Qwen Three ASR。","Hy-MT2 和 VoxCPM2 的在线模型链路。","zh","我们要测试 Qwen Three ASR、Hy-MT2 和 VoxCPM2 的在线模型链路。"],
    ["我们准备采购苹果。","香蕉和梨。","zh","我们准备采购苹果、香蕉和梨。"],
    ["需要检查日志。","缓存与数据库的状态。","zh","需要检查日志、缓存与数据库的状态。"],
    ["备选方案包括本地识别。","云端识别以及人工录入。","zh","备选方案包括本地识别、云端识别以及人工录入。"],
    ["We will test Nova ASR.","Orion MT and Lumen TTS.","en","We will test Nova ASR, Orion MT and Lumen TTS."],
    ["Please bring apples.","Bananas and pears.","en","Please bring apples, Bananas and pears."],
  ] as const)("combines a structural object continuation: %s",(left,right,language,text)=>{
    const a=create();expect(a.push("s",part("first",left,language),0).ready).toHaveLength(1);
    const result=a.push("s",part("second",right,language),4000);
    expect(result.ready).toHaveLength(1);
    expect(result.ready[0]).toMatchObject({segmentId:"first",revision:2,text,timing:{startMs:48632,endMs:55328}});
    expect(result.supersededSegmentIds).toEqual(["second"]);
    expect(a.flush("s",4100)).toEqual([]);
  });

  it.each([
    ["我们准备采购苹果。","香蕉和梨已经卖完了。","zh"],
    ["我们准备采购苹果。","香蕉和梨很新鲜。","zh"],
    ["我们准备采购苹果。","香蕉和梨变便宜了。","zh"],
    ["我们准备采购苹果。","我和他明天出发。","zh"],
    ["我们准备采购苹果。","香蕉和梨好吗？","zh"],
    ["今天下雨。","香蕉和梨。","zh"],
    ["We will test Nova ASR.","Orion MT and Lumen TTS are unavailable.","en"],
    ["We will test Nova ASR.","You and I should go now.","en"],
    ["We need apples.","Bananas and pears cost money.","en"],
    ["We need apples.","Dogs and cats chase birds.","en"],
    ["We finished the meeting.","Apples and pears.","en"],
  ] as const)("does not append an independent clause or guess an object: %s",(left,right,language)=>{
    const a=create();a.push("s",part("first",left,language),0);
    const result=a.push("s",part("second",right,language),1000);
    expect(result.ready[0]?.segmentId).toBe("second");expect(result.supersededSegmentIds).toBeUndefined();
  });

  it("preserves mixed text metadata but distinguishes confirmed source from uncertain language",()=>{
    expect(first().mixedLanguage).toBe(true);
    const a=create();a.push("s",first(),0);
    expect(a.push("s",second(),4000).ready[0]).toMatchObject({segmentId:"first",mixedLanguage:true,language:"zh",automaticLanguageStatus:"detected"});
    for(const status of [undefined,"mixed","unknown"] as const){
      const b=create();b.push("s",{...first(),automaticLanguageStatus:status},0);
      expect(b.push("s",second(),4000).ready[0].segmentId).toBe("second");
    }
    const fixed=new SegmentAssembler({emitSemanticContinuationRevisions:true,semanticSourceLanguage:"zh"});
    fixed.push("s",{...first(),automaticLanguageStatus:undefined},0);
    expect(fixed.push("s",{...second(),automaticLanguageStatus:undefined},4000).ready[0].segmentId).toBe("first");
  });

  it("preserves real language/speaker/turn/overlap boundaries, time and private defaults",()=>{
    for(const change of [
      {language:"en" as const}, {turnId:"other"},
      {speaker:{speakerId:"other",role:"speaker" as const,source:"diarization" as const}},
      {timing:{startMs:51200,endMs:55328,source:"estimated" as const,overlap:true}},
    ]){const a=create();a.push("s",first(),0);expect(a.push("s",{...second(),...change},4000).ready[0].segmentId).toBe("second");}
    const expired=create();expired.push("s",first(),0);expect(expired.push("s",second(),5001).ready[0].segmentId).toBe("second");
    const legacy=new SegmentAssembler();legacy.push("s",first(),0);expect(legacy.push("s",second(),4000).ready[0].segmentId).toBe("second");
  });

  it("rechecks the relationship on corrections and restores constituents if it becomes a separate clause",()=>{
    const a=create();a.push("s",first(),0);a.push("s",second(),4000);
    const correction={...second(),revision:3,text:"Hy-MT2 和 VoxCPM2 已经停止服务。"};
    const split=a.push("s",correction,4200);
    expect(split.ready.map(x=>x.segmentId)).toEqual(["first","second"]);
    expect(split.ready.map(x=>x.text)).toEqual([first().text,correction.text]);
    expect(split.ready.every(x=>x.revision!>=3)).toBe(true);
  });
});
