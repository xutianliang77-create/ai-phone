import type { CallTranscriptRefiner } from "./call-transcript-refiner.js";
import type {
  CallAsrProvider,
  CallDuplexConfig,
  CallRoomEventSink,
  CallTtsAudioSink,
  CallTranslationProvider,
  CallTtsProvider,
} from "./types.js";

export interface CallTranslationWorkerOptions {
  asrProvider: CallAsrProvider;
  translationProvider: CallTranslationProvider;
  ttsProvider?: CallTtsProvider;
  ttsAudioSink?: CallTtsAudioSink;
  eventSink: CallRoomEventSink;
  transcriptRefiner?: CallTranscriptRefiner;
  duplexConfig?: CallDuplexConfig;
  nowMs?: () => number;
}
