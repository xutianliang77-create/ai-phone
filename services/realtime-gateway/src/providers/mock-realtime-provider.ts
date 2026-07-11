import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import type {
  RealtimeProvider,
  RealtimeProviderSession,
  TextSegmentInput,
} from "./realtime-provider.js";

export class MockRealtimeProvider implements RealtimeProvider {
  readonly name = "mock";
  private seenFrames = new Map<string, Set<number>>();
  private sessions = new Map<string, RealtimeProviderSession>();

  async createSession(session: RealtimeProviderSession) {
    this.sessions.set(session.sessionId, session);
    this.seenFrames.set(session.sessionId, new Set<number>());
  }

  async *sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
    const seenFrames = this.seenFrames.get(frame.sessionId) ?? new Set<number>();
    this.seenFrames.set(frame.sessionId, seenFrames);
    if (seenFrames.has(frame.sequence)) return;
    seenFrames.add(frame.sequence);
    if (frame.sequence % 8 !== 0) return;

    const segmentId = `seg_${frame.sequence}`;
    yield {
      type: "transcript.final",
      sessionId: frame.sessionId,
      segmentId,
      text: "hello, this is a realtime translation test",
      language: "en",
      confidence: 0.9,
    };
    yield {
      type: "translation.final",
      sessionId: frame.sessionId,
      segmentId,
      text: "你好，这是一次实时翻译测试。",
      language: "zh",
    };
  }

  async *sendText(segment: TextSegmentInput): AsyncGenerator<ServerRealtimeEvent> {
    const session = this.sessions.get(segment.sessionId);
    if (!session) {
      yield {
        type: "error",
        sessionId: segment.sessionId,
        code: "provider_unavailable",
        message: "Mock session was not found",
      };
      return;
    }

    yield {
      type: segment.isFinal ? "transcript.final" : "transcript.partial",
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      text: segment.text,
      language: segment.language,
      confidence: segment.confidence,
    };
    if (!segment.isFinal) return;

    yield {
      type: "translation.final",
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      text: session.targetLanguage === "zh"
        ? "你好，这是一次实时翻译测试。"
        : "Hello, this is a realtime translation test.",
      language: session.targetLanguage,
    };
  }

  async closeSession(sessionId: string) {
    this.sessions.delete(sessionId);
    this.seenFrames.delete(sessionId);
  }

  async healthCheck() {
    return true;
  }
}
