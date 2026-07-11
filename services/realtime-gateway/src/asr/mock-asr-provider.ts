import type { AudioFrame, TranslationLanguageCode } from "@translation/contracts";
import type { AsrProvider, AsrSession, TranscriptResult } from "./asr-provider.js";

export class MockAsrProvider implements AsrProvider {
  private readonly emitEveryFrames: number;
  private sessions = new Map<string, AsrSession>();
  private seenFrames = new Map<string, Set<number>>();

  constructor(options: { emitEveryFrames?: number } = {}) {
    this.emitEveryFrames = options.emitEveryFrames ?? 8;
  }

  async createSession(session: AsrSession) {
    this.sessions.set(session.sessionId, session);
    this.seenFrames.set(session.sessionId, new Set<number>());
  }

  async transcribe(frame: AudioFrame): Promise<TranscriptResult | null> {
    const session = this.sessions.get(frame.sessionId);
    if (!session) throw new Error("ASR session was not found");

    const seenFrames = this.seenFrames.get(frame.sessionId) ?? new Set<number>();
    this.seenFrames.set(frame.sessionId, seenFrames);
    if (seenFrames.has(frame.sequence)) return null;
    seenFrames.add(frame.sequence);
    if (frame.sequence % this.emitEveryFrames !== 0) return null;

    const language = transcriptLanguage(session);
    return {
      segmentId: `asr_seg_${frame.sequence}`,
      ...mockText(language),
      confidence: 0.9,
    };
  }

  async flush() {
    return null;
  }

  async closeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    this.seenFrames.delete(sessionId);
  }

  async healthCheck() {
    return true;
  }
}

function transcriptLanguage(session: AsrSession): TranslationLanguageCode {
  if (session.sourceLanguage === "zh" || session.sourceLanguage === "en") {
    return session.sourceLanguage;
  }
  return session.targetLanguage === "zh" ? "en" : "zh";
}

function mockText(language: TranslationLanguageCode) {
  if (language === "zh") {
    return {
      text: "你好，这是一次实时翻译测试。",
      language,
    };
  }
  return {
    text: "hello, this is a realtime translation test",
    language,
  };
}
