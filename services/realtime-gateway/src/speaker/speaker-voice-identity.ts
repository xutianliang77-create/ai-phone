import type { TranscriptResult } from "../asr/asr-provider.js";
import type { RecentPcmAudioBuffer } from "./recent-pcm-audio-buffer.js";
import type { VoiceIdentityMatcher } from "./voice-identity-matcher.js";

type SpeakerIdentity = NonNullable<TranscriptResult["speaker"]>;

export async function applyVoiceIdentities(input: {
  transcripts: TranscriptResult[];
  userId?: string;
  matcher?: VoiceIdentityMatcher;
  audio?: RecentPcmAudioBuffer;
  cache?: Map<string, SpeakerIdentity>;
  onFailure: (error: unknown) => void;
}) {
  const { userId, matcher, audio, cache } = input;
  if (!userId || !matcher || !audio || !cache) {
    return input.transcripts;
  }
  return Promise.all(input.transcripts.map(async (transcript) => {
    const diarizedId = transcript.speaker?.speakerId ?? "unknown";
    const cached = cache.get(diarizedId);
    if (cached) return { ...transcript, speaker: cached };
    const audioBase64 = audio.wavBase64(transcript.timing);
    if (!audioBase64) return transcript;
    try {
      const identity = await matcher.match({
        userId,
        audioBase64,
      });
      if (!identity) return transcript;
      if (diarizedId !== "unknown") cache.set(diarizedId, identity);
      return { ...transcript, speaker: identity };
    } catch (error) {
      input.onFailure(error);
      return transcript;
    }
  }));
}
