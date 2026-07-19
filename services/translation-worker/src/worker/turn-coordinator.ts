import type { CallRoomTranslationLanguage } from "@translation/contracts";
import { analyzeTurnLanguage } from "@translation/speech-quality";
import type { CallAudioSpeakerRole, TranscriptSegment } from "./types.js";

interface LanguageState {
  language: CallRoomTranslationLanguage;
  candidate?: CallRoomTranslationLanguage;
  candidateTurns: number;
}

export class TurnCoordinator {
  private readonly languages = new Map<string, LanguageState>();

  stabilizeLanguage(input: {
    callId: string;
    speakerRole: CallAudioSpeakerRole;
    text: string;
    fallbackLanguage: CallRoomTranslationLanguage;
  }) {
    const profile = analyzeTurnLanguage(input.text, input.fallbackLanguage);
    const dominantLanguage: CallRoomTranslationLanguage =
      profile.dominantLanguage === "en" ? "en" : "zh";
    const key = stateKey(input.callId, input.speakerRole);
    const state = this.languages.get(key);
    if (!state) {
      this.languages.set(key, {
        language: dominantLanguage,
        candidateTurns: 0,
      });
      return dominantLanguage;
    }
    if (!profile.mixedLanguage && dominantLanguage !== state.language &&
      isUnambiguousTurn(input.text, dominantLanguage)) {
      state.language = dominantLanguage;
      state.candidate = undefined;
      state.candidateTurns = 0;
      return dominantLanguage;
    }
    if (!profile.mixedLanguage &&
      dominantLanguage !== input.fallbackLanguage) {
      state.language = dominantLanguage;
      state.candidate = undefined;
      state.candidateTurns = 0;
      return dominantLanguage;
    }
    if (profile.mixedLanguage &&
      dominantLanguage !== input.fallbackLanguage) {
      state.candidate = undefined;
      state.candidateTurns = 0;
      return dominantLanguage;
    }
    const proposed = profile.mixedLanguage ? state.language : dominantLanguage;
    if (proposed === state.language) {
      state.candidate = undefined;
      state.candidateTurns = 0;
      return state.language;
    }
    if (state.candidate !== proposed) {
      state.candidate = proposed;
      state.candidateTurns = 1;
      return state.language;
    }
    state.candidateTurns += 1;
    if (state.candidateTurns >= 2) {
      state.language = proposed;
      state.candidate = undefined;
      state.candidateTurns = 0;
    }
    return state.language;
  }

  isHardBoundary(transcript: TranscriptSegment) {
    return transcript.endpointReason === "flush" ||
      transcript.endpointReason === "speaker_boundary";
  }

  clear(callId: string) {
    const prefix = `${callId}:`;
    for (const key of this.languages.keys()) {
      if (key.startsWith(prefix)) this.languages.delete(key);
    }
  }
}

function stateKey(callId: string, speakerRole: CallAudioSpeakerRole) {
  return `${callId}:${speakerRole}`;
}

function isUnambiguousTurn(
  text: string,
  language: CallRoomTranslationLanguage,
) {
  const chineseChars = text.match(/[\u4e00-\u9fff]/gu)?.length ?? 0;
  const englishWords = text.match(/[A-Za-z]+/gu)?.length ?? 0;
  return language === "zh"
    ? chineseChars >= 2 && englishWords === 0
    : englishWords >= 2 && chineseChars === 0;
}
