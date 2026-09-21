import type { SpeechTranscript } from "./speech-transcript.js";

/** Preserve verified evidence, but never promote missing/conflicting evidence
 * using a text-script guess. Legacy transcripts without this field stay legacy. */
export function mergedLanguageEvidence(parts: SpeechTranscript[]) {
  if (!parts.some(part => part.automaticLanguageStatus !== undefined)) return {};
  const detected = parts.every(part => part.automaticLanguageStatus === "detected");
  const sameLanguage = parts.every(part => part.language === parts[0].language);
  const automaticLanguageStatus = detected && sameLanguage ? "detected" as const
    : parts.some(part => part.automaticLanguageStatus === "mixed") || detected && !sameLanguage
      ? "mixed" as const : "unknown" as const;
  return { automaticLanguageStatus };
}
