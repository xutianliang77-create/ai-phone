import type { CallRoomTranslationLanguage } from "@translation/contracts";
import { KeyedAsyncQueue } from "./keyed-async-queue.js";
import type {
  CallAudioSpeakerRole,
  CallTtsAudioSink,
  SynthesizedSpeech,
} from "./types.js";

interface PlaybackInput {
  callId: string;
  segmentId: string;
  speakerRole: CallAudioSpeakerRole;
  targetLanguage: CallRoomTranslationLanguage;
  speech: SynthesizedSpeech;
}

export class CallTtsPlaybackQueue {
  private readonly sinks: CallTtsAudioSink[] = [];
  private readonly queue = new KeyedAsyncQueue();

  constructor(
    private readonly onPlaybackError: (input: PlaybackInput) => Promise<void>,
  ) {}

  addSink(sink: CallTtsAudioSink) {
    this.sinks.push(sink);
  }

  enqueue(input: PlaybackInput) {
    if (this.sinks.length === 0 || !input.speech.audio) return;
    void this.queue.enqueue(input.callId, async () => {
      let failed = false;
      for (const sink of this.sinks) {
        try {
          await sink.play({
            callId: input.callId,
            segmentId: input.segmentId,
            sourceSpeakerRole: input.speakerRole,
            targetSpeakerRole: oppositeSpeakerRole(input.speakerRole),
            language: input.targetLanguage,
            speech: input.speech,
          });
        } catch {
          failed = true;
        }
      }
      if (failed) await this.onPlaybackError(input);
    }).catch(() => undefined);
  }

  drain(callId: string) {
    return this.queue.drain(callId);
  }
}

function oppositeSpeakerRole(role: CallAudioSpeakerRole): CallAudioSpeakerRole {
  return role === "host" ? "guest" : "host";
}
