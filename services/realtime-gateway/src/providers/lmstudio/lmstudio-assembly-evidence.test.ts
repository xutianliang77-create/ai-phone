import { describe, expect, it, vi } from "vitest";
import type { TranscriptResult } from "../../asr/asr-provider.js";
import { LmStudioRealtimeProvider } from "./lmstudio-realtime-provider.js";
import { SegmentAssembler } from "../../segments/segment-assembler.js";
import { transcriptVariantsForTranslation } from "./transcript-chunks.js";

describe("existing semantic assembly on streamed public ASR", () => {
  it("keeps trusted direction changes separate rather than merging two directions", () => {
    const assembler = new SegmentAssembler();
    assembler.push("language-change", {segmentId:"en",text:"I would like to",language:"en",automaticLanguageStatus:"detected"},0);
    const next=assembler.push("language-change", {segmentId:"zh",text:"我们明天出发。",language:"zh",automaticLanguageStatus:"detected"},100);
    expect(next.ready.map(item=>item.segmentId)).toEqual(["en","zh"]);
    expect(next.ready.every(item=>item.automaticLanguageStatus==="detected")).toBe(true);
  });

  it("clears only the explicitly completed empty draft without an MT request", async () => {
    const translate=vi.fn(async()=>"unused");
    const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic.invalid",model:"synthetic",timeoutMs:100,
      asrProvider:{createSession:async()=>{},closeSession:async()=>{},healthCheck:async()=>true,
        transcribe:async()=>({segmentId:"empty-draft",revision:1,isFinal:true,text:"",language:"en"}),flush:async()=>null},
      translationClient:{translate,healthCheck:async()=>true}});
    await provider.createSession({sessionId:"assembly",sourceLanguage:"en",targetLanguage:"zh",voiceOutput:false});
    try{
      const events=[];for await(const event of provider.sendAudio(frame(0)))events.push(event);
      expect(events).toContainEqual(expect.objectContaining({type:"transcript.final",segmentId:"empty-draft",text:""}));
      expect(translate).not.toHaveBeenCalled();
    }finally{await provider.closeSession("assembly");}
  });
  it("retains provider-confirmed language through a held mixed-text final", () => {
    const assembler = new SegmentAssembler();
    const input: TranscriptResult = { segmentId: "confirmed", revision: 1, isFinal: true,
      text: "This is a嗯。", language: "en", automaticLanguageStatus: "detected" };
    expect(assembler.push("session", input, 0).ready).toEqual([]);
    const ready = assembler.flush("session", 2000);
    expect(ready[0]).toMatchObject({ automaticLanguageStatus: "detected", language: "en" });
    expect(transcriptVariantsForTranslation(ready[0], true, true)[0])
      .toMatchObject({ automaticLanguageStatus: "detected", language: "en" });
  });

  it.each(["unknown", "mixed"] as const)("does not promote explicit %s evidence from text heuristics", status => {
    expect(transcriptVariantsForTranslation({ segmentId: "uncertain", text: "Hello there.",
      language: "en", automaticLanguageStatus: status }, true, true)[0].automaticLanguageStatus).toBe(status);
  });

  it.each(["normal", "timeout", "stop"])("clears an absorbed streamed draft on %s release", async mode => {
    let listener: ((value: TranscriptResult) => void) | undefined;
    const chunks: TranscriptResult[] = [
      { segmentId: "first", revision: 1, isFinal: true, text: "This is a", language: "en" },
      { segmentId: "second", revision: 1, isFinal: true, text: mode === "normal" ? "test." : "test of", language: "en" },
    ];
    let index = 0;
    const asr = { createSession: async () => {}, closeSession: async () => {},
      healthCheck: async () => true, flush: async () => null,
      transcribe: async () => chunks[index++] ?? null,
      setPartialListener: (_id: string, next: (value: TranscriptResult) => void) => {
        listener = next; return () => { listener = undefined; };
      } };
    const translate = vi.fn(async () => "这是合成译文。");
    const provider = new LmStudioRealtimeProvider({ baseUrl: "https://synthetic.invalid", model: "synthetic",
      timeoutMs: 100, asrProvider: asr, translationClient: { translate, healthCheck: async () => true } });
    const session = { sessionId: "assembly", sourceLanguage: "en" as const, targetLanguage: "zh" as const, voiceOutput: false };
    const events: Array<{type: string; segmentId?: string; text?: string}> = [];
    await provider.createSession(session);
    const off = provider.setEventListener(session.sessionId, event => events.push(event));
    try {
      for (let n = 0; n < 2; n++) {
        listener!({ ...chunks[n], isFinal: false });
        for await (const event of provider.sendAudio(frame(n))) events.push(event);
      }
      if (mode === "timeout") {
        const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 8000);
        try { for await (const event of provider.sendAudio(frame(2))) events.push(event); }
        finally { clock.mockRestore(); }
      }
      for await (const event of provider.flushSession(session.sessionId, { finishSession: true })) events.push(event);
      expect(events).toContainEqual(expect.objectContaining({ type: "transcript.final", segmentId: "second", text: "" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "transcript.final", segmentId: "first", text: expect.stringContaining("This is a test") }));
      expect(translate).toHaveBeenCalledTimes(1);
    } finally { off(); await provider.closeSession(session.sessionId); }
  });
});

function frame(sequence: number) {
  return { type: "audio.frame" as const, sessionId: "assembly", sequence: sequence + 1,
    timestampMs: sequence * 100, format: "pcm16" as const, sampleRate: 16000, data: "" };
}
