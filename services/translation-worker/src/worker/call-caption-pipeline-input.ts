import type {
  CallRoomSubmittedEvent,
  SpeechPipelineTimingDto,
} from "@translation/contracts";
import type { callRecognitionMetadata } from "./call-recognition-metadata.js";
import type { CallPipelineVersionState } from "./call-pipeline-version-state.js";
import type { BufferedCallTranscript } from "./participant-turn-buffer.js";
import type { CallAudioSpeakerRole } from "./types.js";

export interface CaptionTranslationInput {
  callId: string;
  speakerRole: CallAudioSpeakerRole;
  transcript: BufferedCallTranscript["transcript"];
  identity: ReturnType<CallPipelineVersionState["identity"]>;
  signal: AbortSignal;
  sourceLanguage: CallRoomSubmittedEvent["sourceLanguage"];
  targetLanguage: CallRoomSubmittedEvent["targetLanguage"];
  text: string;
  recognitionMetadata: ReturnType<typeof callRecognitionMetadata>;
  pipelineTiming: SpeechPipelineTimingDto;
  refinedRawText?: string;
  commonEvent: Omit<CallRoomSubmittedEvent, "type" | "timestampMs" | "text">;
}
